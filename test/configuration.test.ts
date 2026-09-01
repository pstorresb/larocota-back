import { describe, expect, it } from "vitest";
import { resolveModifierSelection, type ModifierGroupData } from "../src/modules/catalog/configuration.js";

const groups: ModifierGroupData[] = [{
  id: "group-1", productId: "product-1", name: "Ingredientes", description: null,
  selectionType: "multiple", minSelections: 1, maxSelections: 2, isActive: true, sortOrder: 0,
  options: [
    { id: "chicken", name: "Pollo", description: null, priceDelta: "2.00", includedQuantity: 1, defaultQuantity: 1, maxQuantity: 3, isLocked: false, isActive: true, sortOrder: 0 },
    { id: "avocado", name: "Aguacate", description: null, priceDelta: "1.25", includedQuantity: 0, defaultQuantity: 0, maxQuantity: 1, isLocked: false, isActive: true, sortOrder: 1 },
  ],
}];

describe("product configuration", () => {
  it("does not charge the quantity included in the base price", () => {
    const result = resolveModifierSelection(groups, [{ groupId: "group-1", options: [{ optionId: "chicken", quantity: 1 }] }]);
    expect(result.modifierCents).toBe(0);
    expect(result.snapshot[0]?.chargedQuantity).toBe(0);
  });

  it("charges only quantities above the included amount", () => {
    const result = resolveModifierSelection(groups, [{ groupId: "group-1", options: [{ optionId: "chicken", quantity: 3 }, { optionId: "avocado", quantity: 1 }] }]);
    expect(result.modifierCents).toBe(525);
  });

  it("rejects an omitted required group", () => {
    expect(() => resolveModifierSelection(groups, [])).toThrow("Revisa la selección");
  });

  it("allows an optional single group without a selection", () => {
    const optional: ModifierGroupData[] = [{ ...groups[0]!, selectionType: "single", minSelections: 0, maxSelections: 1 }];
    expect(resolveModifierSelection(optional, []).modifierCents).toBe(0);
  });

  it("rejects removing a locked ingredient", () => {
    const locked: ModifierGroupData[] = [{ ...groups[0]!, minSelections: 0, options: groups[0]!.options.map((option) => option.id === "chicken" ? { ...option, isLocked: true } : option) }];
    expect(() => resolveModifierSelection(locked, [])).toThrow("es un ingrediente fijo");
  });
});
