import type { FastifyPluginAsync } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { requireAdmin, requireSuperadmin } from "../auth/guards.js";
import { isSettingsKey, publicPaymentSettings, publicPickupSettings, settingsSchemas } from "./schema.js";
import { getAllSettings, getSetting } from "./service.js";

export function settingsRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    // What the storefront needs: where to transfer (if configured) and where to pick up.
    app.get("/settings/public", async () => {
      const settings = await getAllSettings(sql);
      return { payment: publicPaymentSettings(settings.payment), pickup: publicPickupSettings(settings.pickup) };
    });

    app.get("/admin/settings", async (request) => {
      const user = await requireAdmin(sql, env, request);
      const settings = await getAllSettings(sql);
      return { settings, canEdit: user.role === "superadmin" };
    });

    app.put<{ Params: { key: string } }>("/admin/settings/:key", async (request, reply) => {
      const user = await requireSuperadmin(sql, env, request);
      const key = request.params.key;
      if (!isSettingsKey(key)) return reply.code(404).send({ code: "SETTING_NOT_FOUND", message: "Ajuste no encontrado." });
      const parsed = settingsSchemas[key].safeParse(request.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return reply.code(400).send({ code: "VALIDATION_ERROR", message: first?.message ?? "Revisa los datos del ajuste.", details: parsed.error.flatten() });
      }
      const before = await getSetting(sql, key);
      await sql.begin(async (tx) => {
        await tx`
          insert into store_settings (key, value, updated_by, updated_at) values (${key}, ${tx.json(parsed.data)}, ${user.id}, now())
          on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
        `;
        await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'store_setting', null, ${`updated:${key}`}, ${tx.json(before)}, ${tx.json(parsed.data)})`;
      });
      return { key, value: parsed.data };
    });
  };
}
