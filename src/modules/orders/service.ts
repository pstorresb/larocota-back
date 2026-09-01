import { randomInt } from "node:crypto";
import type { Database } from "../../db/client.js";
import { loadModifierGroups, resolveModifierSelection, type ModifierSelectionInput } from "../catalog/configuration.js";

export type CheckoutItem = { productId: string; quantity: number; selections: ModifierSelectionInput[]; customerNote?: string };
export type CheckoutInput = {
  userId: string;
  cycleId: string;
  fulfillmentType: "pickup" | "delivery";
  contact: { email: string; firstName: string; lastName: string; phone: string };
  address: { addressLine: string; requestedDeliveryTime: string; sector: string; reference: string; locationText?: string; latitude?: number; longitude?: number };
  customerNotes?: string;
  items: CheckoutItem[];
};

function amount(cents: number) { return (cents / 100).toFixed(2); }
function orderNumber() { return `ROC-${new Date().getUTCFullYear()}-${randomInt(1000, 10_000)}`; }

export async function submitOrder(sql: Database, input: CheckoutInput) {
  return sql.begin(async (tx) => {
    const [cycle] = await tx<{ id: string; status: string; opensAt: Date; closesAt: Date; globalCapacity: number | null; fulfillmentModes: ("pickup" | "delivery")[] }[]>`
      select id, status, opens_at, closes_at, global_capacity, fulfillment_modes from sales_cycles where id = ${input.cycleId} for update
    `;
    const now = new Date();
    if (!cycle || cycle.status !== "open" || cycle.opensAt > now || cycle.closesAt <= now) throw Object.assign(new Error("El ciclo de venta no está abierto."), { statusCode: 409 });
    if (!cycle.fulfillmentModes.includes(input.fulfillmentType)) throw Object.assign(new Error("La modalidad de entrega no está disponible para este ciclo."), { statusCode: 409 });
    const [{ count: cycleReserved = 0 } = { count: 0 }] = await tx<{ count: number }[]>`
      select coalesce(sum(quantity), 0)::int as count from stock_reservations where cycle_id = ${input.cycleId} and status in ('reserved', 'committed')
    `;
    const requestedUnits = input.items.reduce((sum, item) => sum + item.quantity, 0);
    if (cycle.globalCapacity !== null && cycleReserved + requestedUnits > cycle.globalCapacity) throw Object.assign(new Error("Ya no hay cupos suficientes para este ciclo."), { statusCode: 409 });

    const prepared = [] as Array<{ productId: string; name: string; quantity: number; unitBaseCents: number; modifierCents: number; unitTotalCents: number; taxRateBps: number; taxCents: number; subtotalCents: number; totalCents: number; modifierSnapshot: ReturnType<typeof resolveModifierSelection>["snapshot"]; note?: string }>;
    for (const item of input.items) {
      const [product] = await tx<{ id: string; name: string; basePrice: string; taxRate: string; priceOverride: string | null; capacity: number | null; isAvailable: boolean }[]>`
        select p.id, p.name, p.base_price, p.tax_rate, cp.price_override, cp.capacity, cp.is_available
        from cycle_products cp join products p on p.id = cp.product_id
        where cp.cycle_id = ${input.cycleId} and cp.product_id = ${item.productId} and p.is_active = true
        for update
      `;
      if (!product || !product.isAvailable) throw Object.assign(new Error("Uno de los productos ya no está disponible."), { statusCode: 409 });
      const [{ reserved = 0 } = { reserved: 0 }] = await tx<{ reserved: number }[]>`
        select coalesce(sum(quantity), 0)::int as reserved from stock_reservations
        where cycle_id = ${input.cycleId} and product_id = ${item.productId} and status in ('reserved', 'committed')
      `;
      if (product.capacity !== null && reserved + item.quantity > product.capacity) throw Object.assign(new Error(`${product.name} ya no tiene cupos suficientes.`), { statusCode: 409 });
      const unitBaseCents = Math.round(Number(product.priceOverride ?? product.basePrice) * 100);
      const modifierGroups = await loadModifierGroups(tx as unknown as Database, [product.id]);
      const modifiers = resolveModifierSelection(modifierGroups.get(product.id) ?? [], item.selections);
      const unitTotalCents = unitBaseCents + modifiers.modifierCents;
      const subtotalCents = unitTotalCents * item.quantity;
      const taxRateBps = Math.round(Number(product.taxRate) * 10_000);
      const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
      prepared.push({ productId: product.id, name: product.name, quantity: item.quantity, unitBaseCents, modifierCents: modifiers.modifierCents, unitTotalCents, taxRateBps, taxCents, subtotalCents, totalCents: subtotalCents + taxCents, modifierSnapshot: modifiers.snapshot, note: item.customerNote });
    }
    const subtotalCents = prepared.reduce((sum, item) => sum + item.subtotalCents, 0);
    const taxCents = prepared.reduce((sum, item) => sum + item.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
    let created;
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        [created] = await tx<{ id: string; orderNumber: string; status: string }[]>`
          insert into orders (order_number, user_id, sales_cycle_id, status, fulfillment_type, contact_snapshot, address_snapshot, customer_notes, subtotal, tax_total, total, submitted_at)
          values (${orderNumber()}, ${input.userId}, ${input.cycleId}, 'payment_pending', ${input.fulfillmentType}, ${tx.json(input.contact)}, ${tx.json(input.address)}, ${input.customerNotes ?? null}, ${amount(subtotalCents)}, ${amount(taxCents)}, ${amount(totalCents)}, now())
          returning id, order_number, status
        `;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505" || attempt === 2) throw error;
      }
    }
    if (!created) throw new Error("Order creation failed");
    for (const item of prepared) {
      await tx`
        insert into order_items (order_id, product_id, product_name_snapshot, unit_base_price, quantity, modifier_total, unit_total, line_total, tax_total, customer_note, snapshot_json)
        values (${created.id}, ${item.productId}, ${item.name}, ${amount(item.unitBaseCents)}, ${item.quantity}, ${amount(item.modifierCents)}, ${amount(item.unitTotalCents)}, ${amount(item.totalCents)}, ${amount(item.taxCents)}, ${item.note ?? null}, ${tx.json({ productId: item.productId, name: item.name, taxRateBps: item.taxRateBps, modifiers: item.modifierSnapshot })})
      `;
      await tx`insert into stock_reservations (cycle_id, product_id, order_id, quantity, status) values (${input.cycleId}, ${item.productId}, ${created.id}, ${item.quantity}, 'reserved')`;
    }
    await tx`insert into order_status_history (order_id, from_status, to_status, actor_user_id, public_note) values (${created.id}, 'draft', 'payment_pending', ${input.userId}, 'Pedido recibido; comprobante pendiente.')`;
    return { ...created, currency: "USD", subtotalCents, taxCents, totalCents };
  });
}
