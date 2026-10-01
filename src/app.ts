import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { AppEnv } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { orderRoutes } from "./modules/orders/routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";

/**
 * Constraint violations and malformed ids are the client's doing, not a server fault: answer 4xx with a
 * Spanish message instead of a masked 500. Handlers that can say something more specific still should.
 */
function translateDatabaseError(error: Error & { statusCode?: number; code?: unknown }) {
  if (error.statusCode || error.name !== "PostgresError") return error;
  if (error.code === "23505") return Object.assign(new Error("Ya existe un registro con esos datos."), { statusCode: 409, code: "DUPLICATE" });
  if (error.code === "23503") return Object.assign(new Error("No se puede completar: el registro está en uso o hace referencia a algo que ya no existe."), { statusCode: 409, code: "IN_USE" });
  if (error.code === "22P02") return Object.assign(new Error("Registro no encontrado."), { statusCode: 404, code: "NOT_FOUND" });
  return error;
}

export async function buildApp(env: AppEnv) {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    bodyLimit: env.MAX_UPLOAD_BYTES,
    // nginx terminates TLS and forwards the client address; without this every rate limit keys on 127.0.0.1.
    trustProxy: env.TRUST_PROXY,
  });
  const sql = createDatabase(env);
  await app.register(helmet);
  await app.register(cors, { origin: env.FRONTEND_ORIGIN, credentials: true, methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] });
  await app.register(cookie, { secret: undefined });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

  // Must be set before registering plugins: each plugin snapshots the parent's error handler when it is created.
  app.setErrorHandler((error, request, reply) => {
    const appError = translateDatabaseError(error as Error & { statusCode?: number; code?: unknown });
    const statusCode = appError.statusCode && appError.statusCode < 500 ? appError.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    else request.log.warn({ err: error }, "request rejected");
    // Domain errors may carry a stable SCREAMING_SNAKE code (e.g. SLOT_FULL); Postgres and Node codes never match this shape.
    const domainCode = typeof appError.code === "string" && /^[A-Z][A-Z_]+$/.test(appError.code) ? appError.code : null;
    return reply.code(statusCode).send({
      code: statusCode === 500 ? "INTERNAL_ERROR" : domainCode ?? "REQUEST_ERROR",
      message: statusCode === 500 ? "No pudimos procesar la solicitud." : appError.message,
      requestId: request.id,
    });
  });

  app.get("/health", async () => ({ status: "ok", service: "larocota-api" }));
  app.get("/ready", async (_request, reply) => {
    try { await sql`select 1`; return { status: "ready" }; }
    catch { return reply.code(503).send({ status: "unavailable" }); }
  });
  await app.register(authRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(catalogRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(orderRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(paymentRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(settingsRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(adminRoutes(sql, env), { prefix: "/api/v1" });

  app.addHook("onClose", async () => { await sql.end(); });
  app.decorate("sql", sql);
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    sql: ReturnType<typeof createDatabase>;
  }
}
