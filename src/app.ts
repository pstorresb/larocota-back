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

export async function buildApp(env: AppEnv) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, bodyLimit: env.MAX_UPLOAD_BYTES });
  const sql = createDatabase(env);
  await app.register(helmet);
  await app.register(cors, { origin: env.FRONTEND_ORIGIN, credentials: true, methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] });
  await app.register(cookie, { secret: undefined });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

  app.get("/health", async () => ({ status: "ok", service: "larocota-api" }));
  app.get("/ready", async (_request, reply) => {
    try { await sql`select 1`; return { status: "ready" }; }
    catch { return reply.code(503).send({ status: "unavailable" }); }
  });
  await app.register(authRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(catalogRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(orderRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(paymentRoutes(sql, env), { prefix: "/api/v1" });
  await app.register(adminRoutes(sql, env), { prefix: "/api/v1" });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const appError = error as Error & { statusCode?: number };
    const statusCode = appError.statusCode && appError.statusCode < 500 ? appError.statusCode : 500;
    return reply.code(statusCode).send({ code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: statusCode === 500 ? "No pudimos procesar la solicitud." : appError.message, requestId: request.id });
  });
  app.addHook("onClose", async () => { await sql.end(); });
  return app;
}
