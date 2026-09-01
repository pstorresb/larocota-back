import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { z } from "zod";
import { getSessionUser, tokenHash } from "./session.js";

const credentialsSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(10).max(128) });
const registerSchema = credentialsSchema.extend({ firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(24).optional() });

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

    app.post("/auth/register", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los datos de registro." });
      const existing = await sql`select id from users where email = ${parsed.data.email}`;
      if (existing.length) return reply.code(409).send({ code: "ACCOUNT_UNAVAILABLE", message: "No pudimos crear la cuenta con esos datos." });
      const passwordHash = await hashPassword(parsed.data.password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const [user] = await sql<{ id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string }[]>`
        insert into users (email, password_hash, first_name, last_name, phone)
        values (${parsed.data.email}, ${passwordHash}, ${parsed.data.firstName}, ${parsed.data.lastName}, ${parsed.data.phone ?? null})
        returning id, email, first_name, last_name, phone, role
      `;
      if (!user) throw new Error("User creation failed");
      await createSession(reply, user.id);
      return reply.code(201).send({ user: publicUser(user) });
    });

    app.post("/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos." });
      const [user] = await sql<{ id: string; email: string; passwordHash: string; firstName: string; lastName: string; phone: string | null; role: string; status: string }[]>`
        select id, email, password_hash, first_name, last_name, phone, role, status from users where email = ${parsed.data.email}
      `;
      const valid = user && user.status === "active" ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
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
  };
}
