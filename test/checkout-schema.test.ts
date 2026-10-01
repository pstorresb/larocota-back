import { describe, expect, it } from "vitest";
import { checkoutSchema } from "../src/modules/orders/schemas.js";

const base = {
  cycleId: "00000000-0000-4000-8000-000000000001",
  fulfillmentType: "pickup",
  slotStartsAt: "2026-10-09T16:30:00.000Z",
  contact: { email: "ana@example.com", firstName: "Ana", lastName: "Pérez", phone: "0991234567" },
  items: [{ productId: "10000000-0000-4000-8000-000000000001", quantity: 1, selections: [] }],
};

describe("checkout schema", () => {
  it("accepts a pickup order with a slot and no address", () => {
    const parsed = checkoutSchema.safeParse({ ...base, address: null });
    expect(parsed.success).toBe(true);
  });

  it("requires a slot for every order", () => {
    const { slotStartsAt: _omitted, ...withoutSlot } = base;
    const parsed = checkoutSchema.safeParse(withoutSlot);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["slotStartsAt"]);
  });

  it("rejects a slot that is not an ISO 8601 instant", () => {
    expect(checkoutSchema.safeParse({ ...base, slotStartsAt: "11:30" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, slotStartsAt: "2026-10-09T11:30:00-05:00" }).success).toBe(true);
  });

  it("requires an address for delivery and ignores the old requested time field", () => {
    expect(checkoutSchema.safeParse({ ...base, fulfillmentType: "delivery" }).success).toBe(false);
    const parsed = checkoutSchema.safeParse({ ...base, fulfillmentType: "delivery", address: { addressLine: "Av. Mariano Acosta y Gabriela Mistral", requestedDeliveryTime: "12:00" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.address).not.toHaveProperty("requestedDeliveryTime");
  });
});
