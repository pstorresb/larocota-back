import type { FastifyPluginAsync } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { readProductImage } from "../../common/storage/product-images.js";
import { loadModifierGroups } from "./configuration.js";

export function catalogRoutes(sql: Database, env: AppEnv): FastifyPluginAsync {
  return async (app) => {
    async function activeCatalog() {
      const [cycle] = await sql`
        select id, name, status, opens_at, closes_at, fulfillment_at, public_message
        from sales_cycles
        where status in ('open', 'scheduled')
        order by case when status = 'open' then 0 else 1 end, opens_at
        limit 1
      `;
      if (!cycle) return { cycle: null, categories: [], products: [] };
      const products = await sql`
        select p.id, p.name, p.slug, p.short_description as description, p.base_price, p.tax_rate,
          p.image_key, p.image_alt, p.badge, p.updated_at,
          c.id as category_id, c.name as category, c.slug as category_slug,
          cp.capacity, cp.price_override, cp.is_available,
          greatest(coalesce(cp.capacity, 2147483647) - coalesce(sum(sr.quantity) filter (where sr.status in ('reserved', 'committed')), 0), 0)::int as available
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
    app.get<{ Params: { imageKey: string } }>("/media/products/:imageKey", async (request, reply) => {
      const image = await readProductImage(env.UPLOAD_DIR, request.params.imageKey);
      return reply
        .header("Content-Type", image.mimeType)
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Cache-Control", "public, max-age=86400, immutable")
        .send(image.buffer);
    });
  };
}
