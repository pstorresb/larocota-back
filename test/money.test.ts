import { describe, expect, it } from "vitest";
import { calculateLine, calculateOrder } from "../src/common/money.js";

describe("money", () => {
  it("treats prices as tax-inclusive: the total is what is charged and the tax is the share inside it", () => {
    expect(calculateLine({ unitBaseCents: 750, modifierCents: 75, quantity: 2, taxRateBps: 1500 })).toEqual({ unitCents: 825, subtotalCents: 1435, taxCents: 215, totalCents: 1650 });
  });
  it("adds order lines without floating point values", () => {
    expect(calculateOrder([{ unitBaseCents: 625, modifierCents: 0, quantity: 1, taxRateBps: 1500 }, { unitBaseCents: 675, modifierCents: 75, quantity: 2, taxRateBps: 1500 }])).toEqual({ subtotalCents: 1847, taxCents: 278, totalCents: 2125 });
  });
  it("charges exactly the listed price and reports no tax for a zero-rated product", () => {
    expect(calculateLine({ unitBaseCents: 750, modifierCents: 0, quantity: 1, taxRateBps: 1500 })).toEqual({ unitCents: 750, subtotalCents: 652, taxCents: 98, totalCents: 750 });
    expect(calculateLine({ unitBaseCents: 300, modifierCents: 0, quantity: 2, taxRateBps: 0 })).toEqual({ unitCents: 300, subtotalCents: 600, taxCents: 0, totalCents: 600 });
  });
});
