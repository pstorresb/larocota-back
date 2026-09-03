import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { hash as hashPassword } from "@node-rs/argon2";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { deleteUploadedProductImage, storeProductImage } from "../../common/storage/product-images.js";
import { loadModifierGroups } from "../catalog/configuration.js";
import { getSessionUser } from "../auth/session.js";
import { assertTransition, orderStatuses, type OrderStatus } from "../orders/state-machine.js";
import { sendOrderStatusEmail } from "../../common/email/resend.js";

const categorySchema = z.object({ name: z.string().trim().min(2).max(80), slug: z.string().regex(/^[a-z0-9-]+$/).max(80), description: z.string().max(500).optional(), sortOrder: z.number().int().min(0).default(0), isActive: z.boolean().default(true) });
const productSchema = z.object({ categoryId: z.string().uuid(), name: z.string().trim().min(2).max(120), slug: z.string().regex(/^[a-z0-9-]+$/).max(120), shortDescription: z.string().trim().min(5).max(300), description: z.string().max(2000).optional(), imageAlt: z.string().max(180).optional(), badge: z.string().max(40).optional(), basePrice: z.number().min(0).max(10000), taxRate: z.number().min(0).max(1), sortOrder: z.number().int().min(0).default(0), isActive: z.boolean().default(true) });
const cycleSchema = z.object({ name: z.string().trim().min(2).max(120), opensAt: z.coerce.date(), closesAt: z.coerce.date(), fulfillmentAt: z.coerce.date(), globalCapacity: z.number().int().positive().nullable().default(null), fulfillmentModes: z.array(z.enum(["pickup", "delivery"])).min(1), publicMessage: z.string().max(500).optional() }).refine((value) => value.opensAt < value.closesAt && value.closesAt < value.fulfillmentAt, "Las fechas del ciclo no están en orden.");
const categoryUpdateSchema = categorySchema.partial().refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.");
const productUpdateSchema = productSchema.partial().refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.");
const cycleStatusSchema = z.enum(["draft", "scheduled", "open", "closed", "fulfilled", "cancelled"]);
const cycleUpdateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), opensAt: z.coerce.date().optional(), closesAt: z.coerce.date().optional(), fulfillmentAt: z.coerce.date().optional(), globalCapacity: z.number().int().positive().nullable().optional(), fulfillmentModes: z.array(z.enum(["pickup", "delivery"])).min(1).optional(), publicMessage: z.string().max(500).nullable().optional(), status: cycleStatusSchema.optional() }).refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.");
const cycleProductsSchema = z.object({ products: z.array(z.object({ productId: z.string().uuid(), capacity: z.number().int().positive().nullable().default(null), priceOverride: z.number().min(0).nullable().default(null), isAvailable: z.boolean().default(true), sortOrder: z.number().int().min(0).default(0) })).max(500) });
const modifierOptionSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), description: z.string().max(300).optional(), priceDelta: z.number().min(0).max(10000), includedQuantity: z.number().int().min(0).max(20), defaultQuantity: z.number().int().min(0).max(20), maxQuantity: z.number().int().min(1).max(20), isLocked: z.boolean().default(false), isActive: z.boolean().default(true), sortOrder: z.number().int().min(0).default(0) }).refine((option) => option.includedQuantity <= option.maxQuantity && option.defaultQuantity <= option.maxQuantity, "Las cantidades de una opción no son válidas.").refine((option) => !option.isLocked || (option.defaultQuantity > 0 && option.includedQuantity >= option.defaultQuantity), "Una opción fija debe estar incluida y preseleccionada.");
const modifierGroupSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(2).max(100), description: z.string().max(300).optional(), selectionType: z.enum(["single", "multiple"]), minSelections: z.number().int().min(0).max(50), maxSelections: z.number().int().min(1).max(50), isActive: z.boolean().default(true), sortOrder: z.number().int().min(0).default(0), options: z.array(modifierOptionSchema).max(100) }).superRefine((group, context) => {
  if (group.minSelections > group.maxSelections) context.addIssue({ code: "custom", message: "El mínimo no puede superar el máximo." });
  const active = group.options.filter((option) => option.isActive);
  const defaults = active.filter((option) => option.defaultQuantity > 0).length;
  if (group.isActive && active.length === 0) context.addIssue({ code: "custom", message: "Un grupo activo necesita opciones activas." });
  if (group.isActive && group.maxSelections > active.length) context.addIssue({ code: "custom", message: "El máximo supera las opciones activas." });
  if (group.isActive && (defaults < group.minSelections || defaults > group.maxSelections)) context.addIssue({ code: "custom", message: "La selección inicial no cumple los límites del grupo." });
  if (group.selectionType === "single" && (group.maxSelections !== 1 || group.minSelections > 1 || active.some((option) => option.maxQuantity !== 1))) context.addIssue({ code: "custom", message: "Una selección única admite una opción y una unidad." });
});
const productConfigurationSchema = z.object({ groups: z.array(modifierGroupSchema).max(30) });
const userRoleSchema = z.enum(["customer", "admin", "superadmin"]);
const userStatusSchema = z.enum(["active", "disabled"]);
const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(14).max(128),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(24).optional(),
  role: userRoleSchema.default("customer"),
});
const updateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  firstName: z.string().trim().min(2).max(80).optional(),
  lastName: z.string().trim().min(2).max(80).optional(),
  phone: z.union([z.string().trim().min(7).max(24), z.literal("")]).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar.");

async function requireAdmin(sql: Database, env: AppEnv, request: FastifyRequest) {
  const user = await getSessionUser(sql, env, request);
  if (!user) throw Object.assign(new Error("Inicia sesión para continuar."), { statusCode: 401 });
  if (!['admin', 'superadmin'].includes(user.role)) throw Object.assign(new Error("No tienes permiso para esta acción."), { statusCode: 403 });
  return user;
}

async function requireSuperadmin(sql: Database, env: AppEnv, request: FastifyRequest) {
  const user = await requireAdmin(sql, env, request);
  if (user.role !== "superadmin") throw Object.assign(new Error("Solo un superadministrador puede gestionar usuarios."), { statusCode: 403 });
  return user;
}

export function adminRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: { cycleId?: string } }>("/admin/dashboard", async (request) => {
      await requireAdmin(sql, env, request);
      const [cycle] = request.query.cycleId ? await sql`select id, name, global_capacity from sales_cycles where id = ${request.query.cycleId}` : await sql`select id, name, global_capacity from sales_cycles order by fulfillment_at desc limit 1`;
      if (!cycle) return { cycle: null, metrics: { orders: 0, sales: "0", averageTicket: "0", pendingPayments: 0 }, products: [] };
      const [metrics] = await sql`
        select count(*)::int as orders,
          coalesce(sum(total) filter (where status not in ('draft', 'cancelled', 'payment_rejected')), 0) as sales,
          coalesce(avg(total) filter (where status not in ('draft', 'cancelled')), 0) as average_ticket,
          count(*) filter (where status in ('payment_pending', 'payment_review', 'payment_rejected'))::int as pending_payments
        from orders where sales_cycle_id = ${cycle.id}
      `;
      const products = await sql`
        select p.name, cp.capacity,
          coalesce(sum(oi.quantity) filter (where o.status <> 'cancelled'), 0)::int as units
        from cycle_products cp
        join products p on p.id = cp.product_id
        left join orders o on o.sales_cycle_id = cp.cycle_id
        left join order_items oi on oi.order_id = o.id and oi.product_id = cp.product_id
        where cp.cycle_id = ${cycle.id}
        group by p.id, cp.capacity, cp.sort_order
        order by cp.sort_order
      `;
      return { cycle, metrics, products };
    });

    app.get("/admin/categories", async (request) => {
      await requireAdmin(sql, env, request);
      const categories = await sql`
        select c.id, c.name, c.slug, c.description, c.sort_order, c.is_active, c.created_at,
          count(p.id)::int as product_count
        from categories c left join products p on p.category_id = c.id
        group by c.id order by c.sort_order, c.name
      `;
      return { categories };
    });

    app.get("/admin/products", async (request) => {
      await requireAdmin(sql, env, request);
      const products = await sql`
        select p.id, p.category_id, c.name as category_name, p.name, p.slug, p.short_description,
          p.description, p.image_key, p.image_alt, p.badge, p.base_price, p.tax_rate, p.sort_order, p.is_active, p.created_at
        from products p join categories c on c.id = p.category_id
        order by p.sort_order, p.name
      `;
      return { products };
    });

    app.get<{ Params: { productId: string } }>("/admin/products/:productId/configuration", async (request, reply) => {
      await requireAdmin(sql, env, request);
      const [product] = await sql`select id from products where id = ${request.params.productId}`;
      if (!product) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      const groups = await loadModifierGroups(sql, [String(product.id)], true);
      return { groups: groups.get(String(product.id)) ?? [] };
    });

    app.get("/admin/cycles", async (request) => {
      await requireAdmin(sql, env, request);
      const cycles = await sql`
        select sc.id, sc.name, sc.opens_at, sc.closes_at, sc.fulfillment_at, sc.status,
          sc.global_capacity, sc.fulfillment_modes, sc.public_message, sc.created_at,
          count(distinct cp.product_id)::int as product_count,
          count(distinct o.id)::int as order_count
        from sales_cycles sc
        left join cycle_products cp on cp.cycle_id = sc.id
        left join orders o on o.sales_cycle_id = sc.id
        group by sc.id order by sc.fulfillment_at desc
      `;
      return { cycles };
    });

    app.get<{ Params: { cycleId: string } }>("/admin/cycles/:cycleId/products", async (request, reply) => {
      await requireAdmin(sql, env, request);
      const [cycle] = await sql`select id from sales_cycles where id = ${request.params.cycleId}`;
      if (!cycle) return reply.code(404).send({ code: "CYCLE_NOT_FOUND", message: "Ciclo no encontrado." });
      const products = await sql`select product_id, capacity, price_override, is_available, sort_order from cycle_products where cycle_id = ${cycle.id} order by sort_order`;
      return { products };
    });

    app.get<{ Querystring: { cycleId?: string; status?: string; search?: string } }>("/admin/orders", async (request) => {
      await requireAdmin(sql, env, request);
      const search = request.query.search ? `%${request.query.search}%` : null;
      const orders = await sql`
        select o.id, o.order_number, o.status, o.total, o.currency, o.fulfillment_type, o.created_at,
          u.first_name, u.last_name, u.email
        from orders o join users u on u.id = o.user_id
        where (${request.query.cycleId ?? null}::uuid is null or o.sales_cycle_id = ${request.query.cycleId ?? null})
          and (${request.query.status ?? null}::text is null or o.status::text = ${request.query.status ?? null})
          and (${search}::text is null or o.order_number ilike ${search} or u.email ilike ${search})
        order by o.created_at desc limit 100
      `;
      return { orders };
    });

    app.get<{ Params: { orderId: string } }>("/admin/orders/:orderId", async (request, reply) => {
      await requireAdmin(sql, env, request);
      const [order] = await sql`
        select o.id, o.order_number, o.status, o.fulfillment_type, o.contact_snapshot, o.address_snapshot,
          o.customer_notes, o.admin_public_note, o.admin_private_note, o.currency, o.subtotal, o.tax_total,
          o.total, o.created_at, o.submitted_at, o.confirmed_at, sc.fulfillment_at,
          u.first_name, u.last_name, u.email
        from orders o
        join users u on u.id = o.user_id
        join sales_cycles sc on sc.id = o.sales_cycle_id
        where o.id = ${request.params.orderId}
      `;
      if (!order) return reply.code(404).send({ code: "ORDER_NOT_FOUND", message: "Pedido no encontrado." });
      const [items, proofs, history] = await Promise.all([
        sql`select id, product_name_snapshot as name, quantity, unit_base_price, modifier_total, unit_total, line_total, tax_total, customer_note, snapshot_json from order_items where order_id = ${order.id} order by id`,
        sql`select id, status, original_name, mime_type, size_bytes, rejection_reason, created_at, reviewed_at from payment_proofs where order_id = ${order.id} and status <> 'superseded' order by created_at desc limit 1`,
        sql`select osh.id, osh.from_status, osh.to_status, osh.public_note, osh.created_at, concat_ws(' ', u.first_name, u.last_name) as actor_name from order_status_history osh left join users u on u.id = osh.actor_user_id where osh.order_id = ${order.id} order by osh.created_at desc`,
      ]);
      return { order: { ...order, items, proof: proofs[0] ?? null, history } };
    });

    app.get<{ Querystring: { search?: string; role?: string; status?: string } }>("/admin/users", async (request) => {
      await requireAdmin(sql, env, request);
      const search = request.query.search ? `%${request.query.search.trim()}%` : null;
      const role = userRoleSchema.safeParse(request.query.role);
      const status = userStatusSchema.safeParse(request.query.status);
      const users = await sql`
        select u.id, u.email, u.first_name, u.last_name, u.phone, u.role, u.status, u.created_at,
          count(o.id)::int as order_count,
          coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as total_spent
        from users u
        left join orders o on o.user_id = u.id
        where (${search}::text is null or u.email ilike ${search} or concat_ws(' ', u.first_name, u.last_name) ilike ${search})
          and (${role.success ? role.data : null}::user_role is null or u.role = ${role.success ? role.data : null})
          and (${status.success ? status.data : null}::user_status is null or u.status = ${status.success ? status.data : null})
        group by u.id
        order by u.created_at desc
        limit 200
      `;
      return { users };
    });

    app.post("/admin/users", async (request, reply) => {
      const actor = await requireSuperadmin(sql, env, request);
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los datos del usuario." });
      const [existing] = await sql`select id from users where email = ${parsed.data.email}`;
      if (existing) return reply.code(409).send({ code: "EMAIL_IN_USE", message: "Ya existe un usuario con ese correo." });
      const passwordHash = await hashPassword(parsed.data.password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const [user] = await sql`
        insert into users (email, password_hash, first_name, last_name, phone, role)
        values (${parsed.data.email}, ${passwordHash}, ${parsed.data.firstName}, ${parsed.data.lastName}, ${parsed.data.phone ?? null}, ${parsed.data.role})
        returning id, email, first_name, last_name, phone, role, status, created_at
      `;
      if (!user) throw new Error("User creation failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${actor.id}, ${request.id}, 'user', ${user.id}, 'created', ${sql.json(user)})`;
      return reply.code(201).send({ user: { ...user, orderCount: 0, totalSpent: "0" } });
    });

    app.patch<{ Params: { userId: string } }>("/admin/users/:userId", async (request, reply) => {
      const actor = await requireSuperadmin(sql, env, request);
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los cambios del usuario." });
      const [target] = await sql`select id, email, first_name, last_name, phone, role, status from users where id = ${request.params.userId}`;
      if (!target) return reply.code(404).send({ code: "USER_NOT_FOUND", message: "Usuario no encontrado." });
      if (target.id === actor.id && (parsed.data.status === "disabled" || (parsed.data.role && parsed.data.role !== "superadmin"))) {
        return reply.code(409).send({ code: "SELF_LOCKOUT", message: "No puedes quitarte el acceso de superadministrador." });
      }
      if (parsed.data.email && parsed.data.email !== target.email) {
        const [duplicate] = await sql`select id from users where email = ${parsed.data.email} and id <> ${target.id}`;
        if (duplicate) return reply.code(409).send({ code: "EMAIL_IN_USE", message: "Ya existe un usuario con ese correo." });
      }
      const [user] = await sql`
        update users set
          email = coalesce(${parsed.data.email ?? null}, email),
          first_name = coalesce(${parsed.data.firstName ?? null}, first_name),
          last_name = coalesce(${parsed.data.lastName ?? null}, last_name),
          phone = case when ${parsed.data.phone === ""} then null else coalesce(${parsed.data.phone ?? null}, phone) end,
          role = coalesce(${parsed.data.role ?? null}::user_role, role),
          status = coalesce(${parsed.data.status ?? null}::user_status, status)
        where id = ${target.id}
        returning id, email, first_name, last_name, phone, role, status, created_at
      `;
      if (!user) throw new Error("User update failed");
      if (parsed.data.status === "disabled") await sql`update sessions set revoked_at = now() where user_id = ${target.id} and revoked_at is null`;
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${actor.id}, ${request.id}, 'user', ${target.id}, 'updated', ${sql.json(target)}, ${sql.json(user)})`;
      return { user };
    });

    app.patch<{ Params: { orderId: string } }>("/admin/orders/:orderId/status", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const parsed = z.object({ status: z.enum(orderStatuses), publicNote: z.string().max(500).optional(), privateNote: z.string().max(1000).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Estado u observación inválidos." });
      const updated = await sql.begin(async (tx) => {
        const [order] = await tx<{ id: string; status: OrderStatus; orderNumber: string; fulfillmentType: string; contactSnapshot: { email: string; firstName: string } }[]>`select id, status, order_number, fulfillment_type, contact_snapshot from orders where id = ${request.params.orderId} for update`;
        if (!order) throw Object.assign(new Error("Pedido no encontrado."), { statusCode: 404 });
        assertTransition(order.status, parsed.data.status);
        const [result] = await tx`
          update orders set status = ${parsed.data.status}, admin_public_note = coalesce(${parsed.data.publicNote ?? null}, admin_public_note), admin_private_note = coalesce(${parsed.data.privateNote ?? null}, admin_private_note), delivered_at = case when ${parsed.data.status} = 'delivered' then now() else delivered_at end, cancelled_at = case when ${parsed.data.status} = 'cancelled' then now() else cancelled_at end
          where id = ${order.id} returning id, order_number, status, updated_at
        `;
        if (!result) throw new Error("Order status update failed");
        await tx`insert into order_status_history (order_id, from_status, to_status, actor_user_id, public_note, private_note) values (${order.id}, ${order.status}, ${parsed.data.status}, ${user.id}, ${parsed.data.publicNote ?? null}, ${parsed.data.privateNote ?? null})`;
        await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'order', ${order.id}, 'status_changed', ${tx.json({ status: order.status })}, ${tx.json({ status: parsed.data.status })})`;
        if (parsed.data.status === "cancelled") await tx`update stock_reservations set status = 'released' where order_id = ${order.id} and status in ('reserved', 'committed')`;
        return { result, notification: { email: order.contactSnapshot.email, firstName: order.contactSnapshot.firstName, orderNumber: order.orderNumber, status: parsed.data.status, fulfillmentType: order.fulfillmentType } };
      });
      try { await sendOrderStatusEmail(env, updated.notification); } catch (error) { request.log.error({ err: error, orderId: updated.result.id }, "Could not send order status email"); }
      return { order: updated.result };
    });

    app.post<{ Params: { proofId: string } }>("/admin/payments/:proofId/review", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const parsed = z.discriminatedUnion("decision", [z.object({ decision: z.literal("approve") }), z.object({ decision: z.literal("reject"), reason: z.string().trim().min(5).max(500) })]).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Indica una decisión y el motivo cuando corresponda." });
      const result = await sql.begin(async (tx) => {
        const [proof] = await tx<{ id: string; orderId: string; status: string }[]>`select id, order_id, status from payment_proofs where id = ${request.params.proofId} for update`;
        if (!proof) throw Object.assign(new Error("Comprobante no encontrado."), { statusCode: 404 });
        if (proof.status !== "under_review") throw Object.assign(new Error("El comprobante ya fue revisado."), { statusCode: 409 });
        const [order] = await tx<{ id: string; status: OrderStatus; orderNumber: string; fulfillmentType: string; contactSnapshot: { email: string; firstName: string } }[]>`select id, status, order_number, fulfillment_type, contact_snapshot from orders where id = ${proof.orderId} for update`;
        if (!order || order.status !== "payment_review") throw Object.assign(new Error("El pedido no está listo para revisión."), { statusCode: 409 });
        const approved = parsed.data.decision === "approve";
        const nextStatus: OrderStatus = approved ? "confirmed" : "payment_rejected";
        const reason = parsed.data.decision === "reject" ? parsed.data.reason : null;
        await tx`update payment_proofs set status = ${approved ? 'approved' : 'rejected'}, reviewed_by = ${user.id}, reviewed_at = now(), rejection_reason = ${reason} where id = ${proof.id}`;
        await tx`update orders set status = ${nextStatus}, confirmed_at = case when ${approved} then now() else confirmed_at end where id = ${order.id}`;
        await tx`insert into order_status_history (order_id, from_status, to_status, actor_user_id, public_note) values (${order.id}, ${order.status}, ${nextStatus}, ${user.id}, ${approved ? 'Pago confirmado.' : reason})`;
        await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'payment_proof', ${proof.id}, ${approved ? 'approved' : 'rejected'}, ${tx.json({ reason })})`;
        if (approved) await tx`update stock_reservations set status = 'committed' where order_id = ${order.id} and status = 'reserved'`;
        return { proofId: proof.id, orderId: order.id, orderStatus: nextStatus, notification: { email: order.contactSnapshot.email, firstName: order.contactSnapshot.firstName, orderNumber: order.orderNumber, status: nextStatus, fulfillmentType: order.fulfillmentType } };
      });
      if (result.orderStatus === "confirmed") {
        try { await sendOrderStatusEmail(env, result.notification); } catch (error) { request.log.error({ err: error, orderId: result.orderId }, "Could not send payment approval email"); }
      }
      return { result: { proofId: result.proofId, orderId: result.orderId, orderStatus: result.orderStatus } };
    });

    app.post("/admin/categories", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = categorySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa la categoría." });
      const [category] = await sql`insert into categories (name, slug, description, sort_order, is_active) values (${parsed.data.name}, ${parsed.data.slug}, ${parsed.data.description ?? null}, ${parsed.data.sortOrder}, ${parsed.data.isActive}) returning *`;
      if (!category) throw new Error("Category creation failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'category', ${category.id}, 'created', ${sql.json(category)})`;
      return reply.code(201).send({ category });
    });

    app.patch<{ Params: { categoryId: string } }>("/admin/categories/:categoryId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = categoryUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa la categoría." });
      const [before] = await sql`select * from categories where id = ${request.params.categoryId}`;
      if (!before) return reply.code(404).send({ code: "CATEGORY_NOT_FOUND", message: "Categoría no encontrada." });
      const [category] = await sql`update categories set name = coalesce(${parsed.data.name ?? null}, name), slug = coalesce(${parsed.data.slug ?? null}, slug), description = case when ${parsed.data.description === ""} then null else coalesce(${parsed.data.description ?? null}, description) end, sort_order = coalesce(${parsed.data.sortOrder ?? null}, sort_order), is_active = coalesce(${parsed.data.isActive ?? null}, is_active) where id = ${before.id} returning *`;
      if (!category) throw new Error("Category update failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'category', ${before.id}, 'updated', ${sql.json(before)}, ${sql.json(category)})`;
      return { category };
    });

    app.delete<{ Params: { categoryId: string } }>("/admin/categories/:categoryId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const [category] = await sql`update categories set is_active = false where id = ${request.params.categoryId} returning id, name, is_active`;
      if (!category) return reply.code(404).send({ code: "CATEGORY_NOT_FOUND", message: "Categoría no encontrada." });
      await sql`update products set is_active = false where category_id = ${category.id}`;
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'category', ${category.id}, 'disabled', ${sql.json(category)})`;
      return reply.code(204).send();
    });

    app.post("/admin/products", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = productSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa el producto." });
      const [product] = await sql`insert into products (category_id, name, slug, short_description, description, image_alt, badge, base_price, tax_rate, sort_order, is_active) values (${parsed.data.categoryId}, ${parsed.data.name}, ${parsed.data.slug}, ${parsed.data.shortDescription}, ${parsed.data.description ?? null}, ${parsed.data.imageAlt || null}, ${parsed.data.badge || null}, ${parsed.data.basePrice.toFixed(2)}, ${parsed.data.taxRate}, ${parsed.data.sortOrder}, ${parsed.data.isActive}) returning *`;
      if (!product) throw new Error("Product creation failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'product', ${product.id}, 'created', ${sql.json(product)})`;
      return reply.code(201).send({ product });
    });

    app.patch<{ Params: { productId: string } }>("/admin/products/:productId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = productUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa el producto." });
      const [before] = await sql`select * from products where id = ${request.params.productId}`;
      if (!before) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      const [product] = await sql`update products set category_id = coalesce(${parsed.data.categoryId ?? null}::uuid, category_id), name = coalesce(${parsed.data.name ?? null}, name), slug = coalesce(${parsed.data.slug ?? null}, slug), short_description = coalesce(${parsed.data.shortDescription ?? null}, short_description), description = case when ${parsed.data.description === ""} then null else coalesce(${parsed.data.description ?? null}, description) end, image_alt = case when ${parsed.data.imageAlt === ""} then null else coalesce(${parsed.data.imageAlt ?? null}, image_alt) end, badge = case when ${parsed.data.badge === ""} then null else coalesce(${parsed.data.badge ?? null}, badge) end, base_price = coalesce(${parsed.data.basePrice?.toFixed(2) ?? null}::numeric, base_price), tax_rate = coalesce(${parsed.data.taxRate ?? null}::numeric, tax_rate), sort_order = coalesce(${parsed.data.sortOrder ?? null}, sort_order), is_active = coalesce(${parsed.data.isActive ?? null}, is_active) where id = ${before.id} returning *`;
      if (!product) throw new Error("Product update failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'product', ${before.id}, 'updated', ${sql.json(before)}, ${sql.json(product)})`;
      return { product };
    });

    app.post<{ Params: { productId: string } }>("/admin/products/:productId/image", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const [before] = await sql`select id, name, image_key from products where id = ${request.params.productId}`;
      if (!before) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "IMAGE_REQUIRED", message: "Selecciona una imagen." });
      const stored = await storeProductImage({ buffer: await file.toBuffer(), uploadDir: env.UPLOAD_DIR });
      const [product] = await sql`update products set image_key = ${stored.imageKey} where id = ${before.id} returning id, image_key, image_alt`;
      if (!product) throw new Error("Product image update failed");
      await deleteUploadedProductImage(env.UPLOAD_DIR, before.imageKey as string | null);
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'product', ${before.id}, 'image_replaced', ${sql.json(before)}, ${sql.json(product)})`;
      return { product };
    });

    app.delete<{ Params: { productId: string } }>("/admin/products/:productId/image", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const [before] = await sql`select id, image_key from products where id = ${request.params.productId}`;
      if (!before) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      const [product] = await sql`update products set image_key = null where id = ${before.id} returning id, image_key, image_alt`;
      if (!product) throw new Error("Product image removal failed");
      await deleteUploadedProductImage(env.UPLOAD_DIR, before.imageKey as string | null);
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'product', ${product.id}, 'image_removed', ${sql.json(product)})`;
      return reply.code(204).send();
    });

    app.put<{ Params: { productId: string } }>("/admin/products/:productId/configuration", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const parsed = productConfigurationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Revisa la configuración del producto.", details: parsed.error.flatten() });
      const [product] = await sql`select id, name from products where id = ${request.params.productId}`;
      if (!product) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      await sql.begin(async (tx) => {
        const savedGroupIds: string[] = [];
        for (const group of parsed.data.groups) {
          let groupId = group.id;
          if (groupId) {
            const [updated] = await tx`update modifier_groups set name = ${group.name}, description = ${group.description || null}, selection_type = ${group.selectionType}, min_selections = ${group.minSelections}, max_selections = ${group.maxSelections}, is_active = ${group.isActive}, sort_order = ${group.sortOrder} where id = ${groupId} and product_id = ${product.id} returning id`;
            if (!updated) throw Object.assign(new Error("Uno de los grupos ya no pertenece a este producto."), { statusCode: 409 });
          } else {
            const [created] = await tx`insert into modifier_groups (product_id, name, description, selection_type, min_selections, max_selections, is_active, sort_order) values (${product.id}, ${group.name}, ${group.description || null}, ${group.selectionType}, ${group.minSelections}, ${group.maxSelections}, ${group.isActive}, ${group.sortOrder}) returning id`;
            if (!created) throw new Error("Modifier group creation failed");
            groupId = String(created.id);
          }
          savedGroupIds.push(groupId);
          const savedOptionIds: string[] = [];
          for (const option of group.options) {
            let optionId = option.id;
            if (optionId) {
              const [updated] = await tx`update modifier_options set name = ${option.name}, description = ${option.description || null}, price_delta = ${option.priceDelta.toFixed(2)}, included_quantity = ${option.includedQuantity}, default_quantity = ${option.defaultQuantity}, max_quantity = ${option.maxQuantity}, is_locked = ${option.isLocked}, is_default = ${option.defaultQuantity > 0}, is_active = ${option.isActive}, sort_order = ${option.sortOrder} where id = ${optionId} and modifier_group_id = ${groupId} returning id`;
              if (!updated) throw Object.assign(new Error("Una de las opciones ya no pertenece a este grupo."), { statusCode: 409 });
            } else {
              const [created] = await tx`insert into modifier_options (modifier_group_id, name, description, price_delta, included_quantity, default_quantity, max_quantity, is_locked, is_default, is_active, sort_order) values (${groupId}, ${option.name}, ${option.description || null}, ${option.priceDelta.toFixed(2)}, ${option.includedQuantity}, ${option.defaultQuantity}, ${option.maxQuantity}, ${option.isLocked}, ${option.defaultQuantity > 0}, ${option.isActive}, ${option.sortOrder}) returning id`;
              if (!created) throw new Error("Modifier option creation failed");
              optionId = String(created.id);
            }
            savedOptionIds.push(optionId);
          }
          await tx`delete from modifier_options where modifier_group_id = ${groupId} and not (id = any(${savedOptionIds}::uuid[]))`;
        }
        await tx`delete from modifier_groups where product_id = ${product.id} and not (id = any(${savedGroupIds}::uuid[]))`;
        await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'product', ${product.id}, 'configuration_replaced', ${tx.json(parsed.data.groups)})`;
      });
      const groups = await loadModifierGroups(sql, [String(product.id)], true);
      return { groups: groups.get(String(product.id)) ?? [] };
    });

    app.delete<{ Params: { productId: string } }>("/admin/products/:productId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const [product] = await sql`update products set is_active = false where id = ${request.params.productId} returning id, name, is_active`;
      if (!product) return reply.code(404).send({ code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      await sql`update cycle_products set is_available = false where product_id = ${product.id}`;
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'product', ${product.id}, 'disabled', ${sql.json(product)})`;
      return reply.code(204).send();
    });

    app.post("/admin/cycles", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = cycleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa las fechas y capacidad del ciclo." });
      const [cycle] = await sql`insert into sales_cycles (name, opens_at, closes_at, fulfillment_at, status, global_capacity, fulfillment_modes, public_message) values (${parsed.data.name}, ${parsed.data.opensAt}, ${parsed.data.closesAt}, ${parsed.data.fulfillmentAt}, 'draft', ${parsed.data.globalCapacity}, ${sql.json(parsed.data.fulfillmentModes)}, ${parsed.data.publicMessage ?? null}) returning *`;
      if (!cycle) throw new Error("Cycle creation failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'sales_cycle', ${cycle.id}, 'created', ${sql.json(cycle)})`;
      return reply.code(201).send({ cycle });
    });

    app.patch<{ Params: { cycleId: string } }>("/admin/cycles/:cycleId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = cycleUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa el ciclo." });
      const [before] = await sql`select * from sales_cycles where id = ${request.params.cycleId}`;
      if (!before) return reply.code(404).send({ code: "CYCLE_NOT_FOUND", message: "Ciclo no encontrado." });
      const dates = { opensAt: parsed.data.opensAt ?? before.opensAt, closesAt: parsed.data.closesAt ?? before.closesAt, fulfillmentAt: parsed.data.fulfillmentAt ?? before.fulfillmentAt };
      if (!(dates.opensAt < dates.closesAt && dates.closesAt < dates.fulfillmentAt)) return reply.code(400).send({ code: "INVALID_DATES", message: "Las fechas del ciclo no están en orden." });
      const [cycle] = await sql`update sales_cycles set name = coalesce(${parsed.data.name ?? null}, name), opens_at = coalesce(${parsed.data.opensAt ?? null}, opens_at), closes_at = coalesce(${parsed.data.closesAt ?? null}, closes_at), fulfillment_at = coalesce(${parsed.data.fulfillmentAt ?? null}, fulfillment_at), global_capacity = case when ${parsed.data.globalCapacity === null} then null else coalesce(${parsed.data.globalCapacity ?? null}, global_capacity) end, fulfillment_modes = coalesce(${parsed.data.fulfillmentModes ? sql.json(parsed.data.fulfillmentModes) : null}::jsonb, fulfillment_modes), public_message = case when ${parsed.data.publicMessage === null || parsed.data.publicMessage === ""} then null else coalesce(${parsed.data.publicMessage ?? null}, public_message) end, status = coalesce(${parsed.data.status ?? null}::sales_cycle_status, status) where id = ${before.id} returning *`;
      if (!cycle) throw new Error("Cycle update failed");
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (${user.id}, ${request.id}, 'sales_cycle', ${before.id}, 'updated', ${sql.json(before)}, ${sql.json(cycle)})`;
      return { cycle };
    });

    app.put<{ Params: { cycleId: string } }>("/admin/cycles/:cycleId/products", async (request, reply) => {
      const user = await requireAdmin(sql, env, request); const parsed = cycleProductsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Revisa los productos y cupos del ciclo." });
      const [cycle] = await sql`select id from sales_cycles where id = ${request.params.cycleId}`;
      if (!cycle) return reply.code(404).send({ code: "CYCLE_NOT_FOUND", message: "Ciclo no encontrado." });
      await sql.begin(async (tx) => {
        await tx`delete from cycle_products where cycle_id = ${cycle.id}`;
        for (const product of parsed.data.products) await tx`insert into cycle_products (cycle_id, product_id, capacity, price_override, is_available, sort_order) values (${cycle.id}, ${product.productId}, ${product.capacity}, ${product.priceOverride?.toFixed(2) ?? null}, ${product.isAvailable}, ${product.sortOrder})`;
        await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, after_json) values (${user.id}, ${request.id}, 'sales_cycle', ${cycle.id}, 'products_replaced', ${tx.json(parsed.data.products)})`;
      });
      return { products: parsed.data.products };
    });

    app.delete<{ Params: { cycleId: string } }>("/admin/cycles/:cycleId", async (request, reply) => {
      const user = await requireAdmin(sql, env, request);
      const [cycle] = await sql`select id, name from sales_cycles where id = ${request.params.cycleId}`;
      if (!cycle) return reply.code(404).send({ code: "CYCLE_NOT_FOUND", message: "Ciclo no encontrado." });
      const [usage] = await sql`select count(*)::int as orders from orders where sales_cycle_id = ${cycle.id}`;
      if (Number(usage?.orders ?? 0) > 0) return reply.code(409).send({ code: "CYCLE_IN_USE", message: "No puedes eliminar un ciclo que ya tiene pedidos." });
      await sql`delete from sales_cycles where id = ${cycle.id}`;
      await sql`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json) values (${user.id}, ${request.id}, 'sales_cycle', ${cycle.id}, 'deleted', ${sql.json(cycle)})`;
      return reply.code(204).send();
    });
  };
}
