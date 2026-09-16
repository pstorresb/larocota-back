import type { FastifyRequest } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { getSessionUser } from "./session.js";

export async function requireAdmin(sql: Database, env: AppEnv, request: FastifyRequest) {
  const user = await getSessionUser(sql, env, request);
  if (!user) throw Object.assign(new Error("Inicia sesión para continuar."), { statusCode: 401 });
  if (!["admin", "superadmin"].includes(user.role)) throw Object.assign(new Error("No tienes permiso para esta acción."), { statusCode: 403 });
  return user;
}

export async function requireSuperadmin(sql: Database, env: AppEnv, request: FastifyRequest) {
  const user = await requireAdmin(sql, env, request);
  if (user.role !== "superadmin") throw Object.assign(new Error("Solo un superadministrador puede realizar esta acción."), { statusCode: 403 });
  return user;
}
