import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { calculateOrder } from "../../common/money.js";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { getSessionUser } from "../auth/session.js";
import { submitOrder } from "./service.js";
import { loadModifierGroups, resolveModifierSelection } from "../catalog/configuration.js";

const selectionsSchema = z.array(z.object({ groupId: z.string().uuid(), options: z.array(z.object({ optionId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).max(100) })).max(30).default([]);

const quoteSchema = z.object({
  cycleId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(20),
    selections: selectionsSchema,
  })).min(1).max(30),
});

const checkoutSchema = z.object({
  cycleId: z.string().uuid(),
  fulfillmentType: z.enum(["pickup", "delivery"]),
  contact: z.object({ email: z.string().email(), firstName: z.string().min(2).max(80), lastName: z.string().min(2).max(80), phone: z.string().min(7).max(24) }),
  address: z.object({ addressLine: z.string().trim().min(8).max(300), requestedDeliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), sector: z.string().trim().max(120), reference: z.string().trim().max(500), locationText: z.string().trim().max(500).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }),
  customerNotes: z.string().max(500).optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(20), selections: selectionsSchema, customerNote: z.string().max(240).optional() })).min(1).max(30),
});

export function orderRoutes(sql: Database, env: AppEnv): FastifyPluginAsync { return async (app) => {
  app.get("/orders/mine", async (request, reply) => {
    const user = await getSessionUser(sql, env, request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Inicia sesión para consultar tus pedidos." });
    const orders = await sql`
      select o.id, o.order_number, o.status, o.fulfillment_type, o.currency, o.subtotal, o.tax_total, o.total,
        o.created_at, o.submitted_at, sc.fulfillment_at,
        coalesce(json_agg(json_build_object('name', oi.product_name_snapshot, 'quantity', oi.quantity, 'lineTotal', oi.line_total) order by oi.id) filter (where oi.id is not null), '[]'::json) as items
      from orders o
      join sales_cycles sc on sc.id = o.sales_cycle_id
      left join order_items oi on oi.order_id = o.id
      where o.user_id = ${user.id}
      group by o.id, sc.fulfillment_at
      order by o.created_at desc
      limit 100
    `;
    return { orders };
  });

  app.post("/orders/quote", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los productos del pedido.", details: parsed.error.flatten() });
    const productIds = parsed.data.items.map((item) => item.productId);
    const products = await sql<{ id: string; basePrice: string; priceOverride: string | null; taxRate: string }[]>`
      select p.id, p.base_price, cp.price_override, p.tax_rate
      from cycle_products cp join products p on p.id = cp.product_id
      where cp.cycle_id = ${parsed.data.cycleId} and cp.is_available and p.is_active and p.id = any(${productIds}::uuid[])
    `;
    const byId = new Map(products.map((product) => [product.id, product]));
    const modifierGroups = await loadModifierGroups(sql, productIds);
    const lines = parsed.data.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) throw Object.assign(new Error("Producto no disponible."), { statusCode: 404 });
      const modifiers = resolveModifierSelection(modifierGroups.get(item.productId) ?? [], item.selections);
      return { productId: item.productId, unitBaseCents: Math.round(Number(product.priceOverride ?? product.basePrice) * 100), modifierCents: modifiers.modifierCents, quantity: item.quantity, taxRateBps: Math.round(Number(product.taxRate) * 10_000) };
    });
    return { currency: "USD", ...calculateOrder(lines), items: lines.map((line) => ({ productId: line.productId, modifierCents: line.modifierCents, unitCents: line.unitBaseCents + line.modifierCents })), expiresInSeconds: 300 };
  });
  app.post("/orders", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const user = await getSessionUser(sql, env, request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Inicia sesión para finalizar el pedido." });
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los datos del pedido.", details: parsed.error.flatten() });
    const order = await submitOrder(sql, { ...parsed.data, userId: user.id });
    return reply.code(201).send({ order });
  });
}; }
