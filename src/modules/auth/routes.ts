import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { z } from "zod";
import { getSessionUser, tokenHash } from "./session.js";
import { sendPinEmail } from "../../common/email/resend.js";

const credentialsSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(128) });
const registerSchema = credentialsSchema.extend({ firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(24).optional() });
const verifyRegistrationSchema = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().regex(/^\d{6}$/) });
const resetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const resetVerifySchema = resetRequestSchema.extend({ code: z.string().regex(/^\d{6}$/), password: z.string().min(10).max(128) });
const profileSchema = z.object({ firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(24) });
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function safeNext(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function codeHash(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function publicUser(user: { id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }) {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role };
}

export function authRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    async function createSession(reply: FastifyReply, userId: string) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
      await sql`insert into sessions (user_id, token_hash, expires_at) values (${userId}, ${tokenHash(token)}, ${expiresAt})`;
      reply.setCookie(env.SESSION_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", expires: expiresAt });
    }

    function googleConfigured() {
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
    }

    function clearGoogleCookies(reply: FastifyReply) {
      reply.clearCookie("larocota_google_state", { path: "/api/v1/auth/google" });
      reply.clearCookie("larocota_google_next", { path: "/api/v1/auth/google" });
    }

    function googleError(reply: FastifyReply, code: string) {
      clearGoogleCookies(reply);
      return reply.redirect(`${env.FRONTEND_ORIGIN}/login?google_error=${encodeURIComponent(code)}`);
    }

    app.post("/auth/register/request-code", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los datos de registro." });
      const existing = await sql`select id from users where email = ${parsed.data.email}`;
      if (existing.length) return reply.code(409).send({ code: "ACCOUNT_EXISTS", message: "Ya existe una cuenta con este correo. Inicia sesión o usa Google." });
      const [pending] = await sql<{ lastSentAt: Date; sendCount: number }[]>`
        select last_sent_at, send_count from email_signup_verifications where email = ${parsed.data.email} and expires_at > now()
      `;
      if (pending && Date.now() - new Date(pending.lastSentAt).getTime() < 60_000) {
        return reply.code(429).send({ code: "CODE_RECENTLY_SENT", message: "Espera un minuto antes de solicitar otro código." });
      }
      if (pending && pending.sendCount >= 3) return reply.code(429).send({ code: "CODE_LIMIT_REACHED", message: "Inténtalo nuevamente en unos minutos." });
      if (!env.RESEND_API_KEY) return reply.code(503).send({ code: "EMAIL_UNAVAILABLE", message: "El correo de confirmación todavía no está configurado." });
      const passwordHash = await hashPassword(parsed.data.password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      await sql`
        insert into email_signup_verifications (email, password_hash, first_name, last_name, phone, code_hash, expires_at, attempts, send_count, last_sent_at)
        values (${parsed.data.email}, ${passwordHash}, ${parsed.data.firstName}, ${parsed.data.lastName}, ${parsed.data.phone ?? null}, ${codeHash(code)}, ${expiresAt}, 0, 1, now())
        on conflict (email) do update set password_hash = excluded.password_hash, first_name = excluded.first_name, last_name = excluded.last_name, phone = excluded.phone, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, send_count = email_signup_verifications.send_count + 1, last_sent_at = now()
      `;
      try {
        await sendPinEmail(env, { to: parsed.data.email, code, purpose: "signup" });
      } catch (error) {
        request.log.error({ err: error }, "Could not send signup verification email");
        await sql`delete from email_signup_verifications where email = ${parsed.data.email} and code_hash = ${codeHash(code)}`;
        return reply.code(503).send({ code: "EMAIL_DELIVERY_FAILED", message: "No pudimos enviar el código. Inténtalo nuevamente." });
      }
      return reply.code(202).send({ expiresInSeconds: 600 });
    });

    app.post("/auth/register/verify", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = verifyRegistrationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Ingresa el código de seis dígitos." });
      const [pending] = await sql<{ email: string; passwordHash: string; firstName: string; lastName: string; phone: string | null; codeHash: string; expiresAt: Date; attempts: number }[]>`
        select email, password_hash, first_name, last_name, phone, code_hash, expires_at, attempts
        from email_signup_verifications where email = ${parsed.data.email}
      `;
      if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
        if (pending) await sql`delete from email_signup_verifications where email = ${parsed.data.email}`;
        return reply.code(400).send({ code: "CODE_EXPIRED", message: "El código expiró. Solicita uno nuevo." });
      }
      if (pending.attempts >= 5) return reply.code(429).send({ code: "CODE_ATTEMPTS_EXCEEDED", message: "Se agotaron los intentos. Solicita un código nuevo." });
      if (!sameToken(codeHash(parsed.data.code), pending.codeHash)) {
        await sql`update email_signup_verifications set attempts = attempts + 1 where email = ${parsed.data.email}`;
        return reply.code(400).send({ code: "INVALID_CODE", message: "El código no es correcto. Revisa el correo e inténtalo nuevamente." });
      }
      const [user] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }[]>`
        insert into users (email, password_hash, first_name, last_name, phone, email_verified_at)
        values (${pending.email}, ${pending.passwordHash}, ${pending.firstName}, ${pending.lastName}, ${pending.phone}, now())
        on conflict (email) do nothing
        returning id, email, first_name, last_name, phone, role
      `;
      if (!user) return reply.code(409).send({ code: "ACCOUNT_EXISTS", message: "Ya existe una cuenta con este correo. Inicia sesión." });
      await sql`delete from email_signup_verifications where email = ${pending.email}`;
      await createSession(reply, user.id);
      return reply.code(201).send({ user: publicUser(user) });
    });

    app.post("/auth/password-reset/request", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = resetRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Ingresa un correo válido." });
      if (!env.RESEND_API_KEY) return reply.code(503).send({ code: "EMAIL_UNAVAILABLE", message: "El correo de recuperación todavía no está configurado." });
      const [user] = await sql<{ id: string; email: string; passwordHash: string | null; status: string }[]>`select id, email, password_hash, status from users where email = ${parsed.data.email}`;
      if (!user || user.status !== "active" || !user.passwordHash) return reply.code(202).send({ message: "Si existe una cuenta con contraseña para este correo, recibirás un PIN." });
      const [pending] = await sql<{ lastSentAt: Date; sendCount: number }[]>`select last_sent_at, send_count from password_recovery_codes where email = ${user.email} and expires_at > now()`;
      if (pending && Date.now() - new Date(pending.lastSentAt).getTime() < 60_000) return reply.code(429).send({ code: "CODE_RECENTLY_SENT", message: "Espera un minuto antes de solicitar otro código." });
      if (pending && pending.sendCount >= 3) return reply.code(429).send({ code: "CODE_LIMIT_REACHED", message: "Inténtalo nuevamente en unos minutos." });
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      await sql`insert into password_recovery_codes (email, user_id, code_hash, expires_at, attempts, send_count, last_sent_at) values (${user.email}, ${user.id}, ${codeHash(code)}, ${expiresAt}, 0, 1, now()) on conflict (email) do update set user_id = excluded.user_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, send_count = password_recovery_codes.send_count + 1, last_sent_at = now()`;
      try { await sendPinEmail(env, { to: user.email, code, purpose: "recovery" }); }
      catch (error) { request.log.error({ err: error }, "Could not send password recovery email"); await sql`delete from password_recovery_codes where email = ${user.email} and code_hash = ${codeHash(code)}`; return reply.code(503).send({ code: "EMAIL_DELIVERY_FAILED", message: "No pudimos enviar el código. Inténtalo nuevamente." }); }
      return reply.code(202).send({ message: "Si existe una cuenta con contraseña para este correo, recibirás un PIN." });
    });

    app.post("/auth/password-reset/verify", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = resetVerifySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa el PIN y la nueva contraseña." });
      const [pending] = await sql<{ email: string; userId: string; codeHash: string; expiresAt: Date; attempts: number }[]>`select email, user_id, code_hash, expires_at, attempts from password_recovery_codes where email = ${parsed.data.email}`;
      if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) { if (pending) await sql`delete from password_recovery_codes where email = ${parsed.data.email}`; return reply.code(400).send({ code: "CODE_EXPIRED", message: "El código expiró. Solicita uno nuevo." }); }
      if (pending.attempts >= 5) return reply.code(429).send({ code: "CODE_ATTEMPTS_EXCEEDED", message: "Se agotaron los intentos. Solicita un código nuevo." });
      if (!sameToken(codeHash(parsed.data.code), pending.codeHash)) { await sql`update password_recovery_codes set attempts = attempts + 1 where email = ${pending.email}`; return reply.code(400).send({ code: "INVALID_CODE", message: "El código no es correcto." }); }
      const passwordHash = await hashPassword(parsed.data.password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const [user] = await sql.begin(async (tx) => {
        const [updated] = await tx<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }[]>`update users set password_hash = ${passwordHash} where id = ${pending.userId} and status = 'active' returning id, email, first_name, last_name, phone, role`;
        if (!updated) throw Object.assign(new Error("No pudimos actualizar la contraseña."), { statusCode: 409 });
        await tx`update sessions set revoked_at = now() where user_id = ${pending.userId} and revoked_at is null`;
        await tx`delete from password_recovery_codes where email = ${pending.email}`;
        return [updated];
      });
      if (!user) throw new Error("Password update failed");
      await createSession(reply, user.id);
      return { user: publicUser(user) };
    });

    app.post("/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos." });
      const [user] = await sql<{ id: string; email: string; passwordHash: string | null; firstName: string; lastName: string; phone: string | null; role: string; status: string }[]>`
        select id, email, password_hash, first_name, last_name, phone, role, status from users where email = ${parsed.data.email}
      `;
      const valid = user?.status === "active" && user.passwordHash ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
      if (!user || !valid) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos." });
      await createSession(reply, user.id);
      return { user: publicUser(user) };
    });

    app.post("/auth/logout", async (request, reply) => {
      const token = request.cookies[env.SESSION_COOKIE_NAME];
      if (token) await sql`update sessions set revoked_at = now() where token_hash = ${tokenHash(token)} and revoked_at is null`;
      reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(204).send();
    });

    app.get("/auth/me", async (request, reply) => {
      const user = await getSessionUser(sql, env, request);
      if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Tu sesión ya no es válida." });
      return { user: publicUser(user) };
    });

    app.patch("/auth/profile", async (request, reply) => {
      const sessionUser = await getSessionUser(sql, env, request);
      if (!sessionUser) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Inicia sesión para actualizar tu perfil." });
      const parsed = profileSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa tu nombre y teléfono." });
      const [user] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }[]>`
        update users set first_name = ${parsed.data.firstName}, last_name = ${parsed.data.lastName}, phone = ${parsed.data.phone}
        where id = ${sessionUser.id}
        returning id, email, first_name, last_name, phone, role
      `;
      if (!user) throw new Error("Profile update failed");
      return { user: publicUser(user) };
    });

    app.get<{ Querystring: { next?: string } }>("/auth/google", async (request, reply) => {
      if (!googleConfigured()) return reply.code(503).send({ code: "GOOGLE_AUTH_UNAVAILABLE", message: "El acceso con Google todavía no está configurado." });
      const state = randomBytes(24).toString("base64url");
      const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", path: "/api/v1/auth/google", maxAge: 600 };
      reply.setCookie("larocota_google_state", state, cookieOptions);
      reply.setCookie("larocota_google_next", safeNext(request.query.next), cookieOptions);
      const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorization.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.GOOGLE_REDIRECT_URI!, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
      return reply.redirect(authorization.toString());
    });

    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/google/callback", async (request, reply) => {
      if (!googleConfigured()) return googleError(reply, "not_configured");
      const expectedState = request.cookies.larocota_google_state;
      if (request.query.error || !request.query.code || !request.query.state || !expectedState || !sameToken(request.query.state, expectedState)) return googleError(reply, "cancelled_or_invalid");
      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: request.query.code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: env.GOOGLE_REDIRECT_URI!, grant_type: "authorization_code" }),
        });
        if (!tokenResponse.ok) return googleError(reply, "token_exchange_failed");
        const token = z.object({ id_token: z.string() }).parse(await tokenResponse.json());
        const { payload } = await jwtVerify(token.id_token, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: env.GOOGLE_CLIENT_ID });
        const claims = z.object({ sub: z.string().min(1), email: z.string().email(), email_verified: z.boolean(), given_name: z.string().optional(), family_name: z.string().optional(), name: z.string().optional() }).parse(payload);
        if (!claims.email_verified) return googleError(reply, "email_not_verified");
        const email = claims.email.toLowerCase();
        let [user] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string; status: string }[]>`
          select u.id, u.email, u.first_name, u.last_name, u.phone, u.role, u.status
          from oauth_identities oi join users u on u.id = oi.user_id
          where oi.provider = 'google' and oi.provider_subject = ${claims.sub}
        `;
        if (!user) {
          const [existing] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string; status: string }[]>`
            select id, email, first_name, last_name, phone, role, status from users where email = ${email}
          `;
          if (existing && existing.role !== "customer") return googleError(reply, "admin_link_blocked");
          if (existing) user = existing;
          else {
            const fallbackParts = (claims.name ?? "Cliente La Rocota").trim().split(/\s+/);
            const firstName = claims.given_name?.trim() || fallbackParts[0] || "Cliente";
            const lastName = claims.family_name?.trim() || fallbackParts.slice(1).join(" ") || "La Rocota";
            [user] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string; status: string }[]>`
              insert into users (email, password_hash, first_name, last_name, email_verified_at)
              values (${email}, null, ${firstName}, ${lastName}, now())
              returning id, email, first_name, last_name, phone, role, status
            `;
          }
          if (!user) throw new Error("Google user creation failed");
          await sql`insert into oauth_identities (user_id, provider, provider_subject, provider_email) values (${user.id}, 'google', ${claims.sub}, ${email})`;
        }
        if (user.status !== "active") return googleError(reply, "account_disabled");
        await createSession(reply, user.id);
        const requestedNext = safeNext(request.cookies.larocota_google_next);
        clearGoogleCookies(reply);
        const destination = user.phone ? requestedNext : `/account?complete=1&next=${encodeURIComponent(requestedNext)}`;
        return reply.redirect(`${env.FRONTEND_ORIGIN}${destination}`);
      } catch (error) {
        request.log.warn({ err: error }, "Google authentication failed");
        return googleError(reply, "authentication_failed");
      }
    });
  };
}
