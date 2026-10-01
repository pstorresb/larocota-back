import type { FastifyPluginAsync } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { readProductImage } from "../../common/storage/product-images.js";
import { loadModifierGroups } from "./configuration.js";
import { buildSlots } from "../cycles/slots.js";

type CatalogCycleRow = {
  id: string; name: string; status: string; opensAt: Date; closesAt: Date;
  fulfillmentStartsAt: Date; fulfillmentEndsAt: Date; slotMinutes: number; slotCapacity: number | null;
  globalCapacity: number | null; publicMessage: string | null; fulfillmentModes: string[]; isOpen: boolean;
};

export function catalogRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    /** Adds remaining global capacity and the computed slot grid with per-slot remaining seats. */
    async function decorateCycle(cycle: CatalogCycleRow) {
      const [reservedRow] = await sql<{ reserved: number }[]>`
        select coalesce(sum(quantity), 0)::int as reserved from stock_reservations
        where cycle_id = ${cycle.id}
          and (status = 'committed' or (status = 'reserved' and (expires_at is null or expires_at > now())))
      `;
      // A slot seat is an order (one arrival / one courier stop), not a unit. Pending orders hold their seat
      // during the payment window; the maintenance job cancels them when it expires.
      const occupancy = await sql<{ slotStartsAt: Date; orders: number }[]>`
        select slot_starts_at, count(*)::int as orders from orders
        where sales_cycle_id = ${cycle.id} and status <> 'cancelled' and slot_starts_at is not null
        group by slot_starts_at
      `;
      const taken = new Map(occupancy.map((row) => [new Date(row.slotStartsAt).getTime(), row.orders]));
      const slots = buildSlots(cycle).map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        remaining: cycle.slotCapacity === null ? null : Math.max(0, cycle.slotCapacity - (taken.get(slot.startsAt.getTime()) ?? 0)),
      }));
      const reserved = reservedRow?.reserved ?? 0;
      return {
        ...cycle,
        globalRemaining: cycle.globalCapacity === null ? null : Math.max(0, cycle.globalCapacity - reserved),
        slots,
      };
    }

    async function activeCatalog() {
      // An open cycle inside its window wins; otherwise the next scheduled one is shown as "coming soon" (isOpen = false).
      const [cycleRow] = await sql<CatalogCycleRow[]>`
        select id, name, status, opens_at, closes_at, fulfillment_starts_at, fulfillment_ends_at,
          slot_minutes, slot_capacity, global_capacity, public_message, fulfillment_modes,
          (status = 'open' and opens_at <= now() and closes_at > now()) as is_open
        from sales_cycles
        where (status = 'open' and opens_at <= now() and closes_at > now())
           or (status = 'scheduled' and closes_at > now())
        order by case when status = 'open' then 0 else 1 end, opens_at
        limit 1
      `;
      if (!cycleRow) return { cycle: null, categories: [], products: [] };
      const cycle = await decorateCycle(cycleRow);
      const products = await sql`
        select p.id, p.name, p.slug, p.short_description as description, p.base_price, p.tax_rate,
          p.image_key, p.image_alt, p.badge, p.updated_at,
          c.id as category_id, c.name as category, c.slug as category_slug,
          cp.capacity, cp.price_override, cp.is_available,
          greatest(coalesce(cp.capacity, 2147483647) - coalesce(sum(sr.quantity) filter (where sr.status = 'committed' or (sr.status = 'reserved' and (sr.expires_at is null or sr.expires_at > now()))), 0), 0)::int as available
        from cycle_products cp
        join products p on p.id = cp.product_id and p.is_active
        join categories c on c.id = p.category_id and c.is_active
        left join stock_reservations sr on sr.cycle_id = cp.cycle_id and sr.product_id = cp.product_id
        where cp.cycle_id = ${cycle.id} and cp.is_available
        group by p.id, c.id, cp.capacity, cp.price_override, cp.is_available, cp.sort_order
        order by c.sort_order, cp.sort_order, p.name
      `;
      const categories = await sql`
        select distinct c.id, c.name, c.slug, c.sort_order
        from cycle_products cp join products p on p.id = cp.product_id join categories c on c.id = p.category_id
        where cp.cycle_id = ${cycle.id} and cp.is_available and p.is_active and c.is_active
        order by c.sort_order, c.name
      `;
      const modifierGroups = await loadModifierGroups(sql, products.map((product) => String(product.id)));
      return {
        cycle,
        categories,
        products: products.map((product) => ({
          ...product,
          imageUrl: product.imageKey ? `/media/products/${encodeURIComponent(String(product.imageKey))}?v=${new Date(product.updatedAt as string | Date).getTime()}` : null,
          basePriceCents: Math.round(Number(product.priceOverride ?? product.basePrice) * 100),
          taxRateBps: Math.round(Number(product.taxRate) * 10_000),
          modifierGroups: (modifierGroups.get(String(product.id)) ?? []).map((group) => ({
            ...group,
            options: group.options.map((option) => ({ ...option, priceDeltaCents: Math.round(Number(option.priceDelta) * 100) })),
          })),
        })),
      };
    }

    app.get("/cycles/active", async (_request, reply) => {
      const catalog = await activeCatalog();
      if (!catalog.cycle) return reply.code(404).send({ code: "NO_ACTIVE_CYCLE", message: "No hay un ciclo de venta publicado." });
      return catalog.cycle;
    });
    app.get("/catalog", activeCatalog);
    // Public, cached images must not consume the per-IP API budget.
    app.get<{ Params: { imageKey: string } }>("/media/products/:imageKey", { config: { rateLimit: false } }, async (request, reply) => {
      const image = await readProductImage(env.UPLOAD_DIR, request.params.imageKey);
      return reply
        .header("Content-Type", image.mimeType)
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cache-Control", "public, max-age=86400, immutable")
        .send(image.buffer);
    });
  };
}
