import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { storeProof } from "../../common/storage/proofs.js";
import { getSessionUser } from "../auth/session.js";

export function paymentRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Params: { orderId: string } }>("/orders/:orderId/payment-proof", { config: { rateLimit: { max: 6, timeWindow: "15 minutes" } } }, async (request, reply) => {
      const user = await getSessionUser(sql, env, request);
      if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Inicia sesión para continuar." });
      const [order] = await sql<{ id: string; status: string }[]>`
        select id, status from orders where id = ${request.params.orderId} and user_id = ${user.id}
      `;
      if (!order) return reply.code(404).send({ code: "NOT_FOUND", message: "Pedido no encontrado." });
      if (!['payment_pending', 'payment_rejected'].includes(order.status)) return reply.code(409).send({ code: "INVALID_STATE", message: "Este pedido no admite otro comprobante." });
      const file = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } });
      if (!file) return reply.code(400).send({ code: "FILE_REQUIRED", message: "Selecciona un comprobante." });
      const buffer = await file.toBuffer();
      const stored = await storeProof({ buffer, originalName: file.filename, uploadDir: env.UPLOAD_DIR });
      try {
        const proof = await sql.begin(async (tx) => {
          await tx`update payment_proofs set status = 'superseded', updated_at = now() where order_id = ${order.id} and status in ('pending', 'under_review', 'rejected')`;
          const [created] = await tx<{ id: string; status: string; createdAt: Date }[]>`
            insert into payment_proofs (order_id, status, original_name, stored_name, mime_type, size_bytes, sha256)
            values (${order.id}, 'under_review', ${stored.originalName}, ${stored.storedName}, ${stored.mimeType}, ${stored.sizeBytes}, ${stored.sha256}) returning id, status, created_at
          `;
          await tx`update orders set status = 'payment_review', updated_at = now() where id = ${order.id}`;
          await tx`insert into order_status_history (order_id, from_status, to_status, actor_user_id, public_note) values (${order.id}, ${order.status}, 'payment_review', ${user.id}, 'Comprobante recibido y en revisión.')`;
          return created;
        });
        return reply.code(201).send({ proof });
      } catch (error) {
        await unlink(stored.path).catch(() => undefined);
        throw error;
      }
    });

    app.get<{ Params: { proofId: string } }>("/payment-proofs/:proofId/file", async (request, reply) => {
      const user = await getSessionUser(sql, env, request);
      if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Inicia sesión para continuar." });
      const [proof] = await sql<{ storedName: string; mimeType: string }[]>`
        select pp.stored_name, pp.mime_type from payment_proofs pp join orders o on o.id = pp.order_id
        where pp.id = ${request.params.proofId} and (o.user_id = ${user.id} or ${user.role} in ('admin', 'superadmin'))
      `;
      if (!proof) return reply.code(404).send({ code: "NOT_FOUND", message: "Comprobante no encontrado." });
      reply
        .header("Content-Disposition", "inline")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cache-Control", "private, no-store")
        .type(proof.mimeType);
      return reply.send(createReadStream(resolve(env.UPLOAD_DIR, "payment-proofs", proof.storedName)));
    });
  };
}
