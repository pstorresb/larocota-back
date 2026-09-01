import { describe, expect, it } from "vitest";
import { calculateLine, calculateOrder } from "../src/common/money.js";

describe("money", () => {
  it("calculates modifiers, quantity and rounded tax in cents", () => {
    expect(calculateLine({ unitBaseCents: 750, modifierCents: 75, quantity: 2, taxRateBps: 1500 })).toEqual({ unitCents: 825, subtotalCents: 1650, taxCents: 248, totalCents: 1898 });
  });
  it("adds order lines without floating point values", () => {
    expect(calculateOrder([{ unitBaseCents: 625, modifierCents: 0, quantity: 1, taxRateBps: 1500 }, { unitBaseCents: 675, modifierCents: 75, quantity: 2, taxRateBps: 1500 }])).toEqual({ subtotalCents: 2125, taxCents: 319, totalCents: 2444 });
  });
});
