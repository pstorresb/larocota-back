import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = { id: string; email: string; firstName: string; lastName: string; phone: string | null; role: "customer" | "admin" | "superadmin" };

export async function getSessionUser(sql: Database, env: AppEnv, request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[env.SESSION_COOKIE_NAME];
  if (!token) return null;
  const [user] = await sql<SessionUser[]>`
    select u.id, u.email, u.first_name, u.last_name, u.phone, u.role
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)} and s.revoked_at is null and s.expires_at > now() and u.status = 'active'
  `;
  return user ?? null;
}
