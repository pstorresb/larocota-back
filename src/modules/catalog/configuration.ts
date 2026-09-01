import type { Database } from "../../db/client.js";

export type ModifierOptionData = {
  id: string;
  name: string;
  description: string | null;
  priceDelta: string;
  includedQuantity: number;
  defaultQuantity: number;
  maxQuantity: number;
  isLocked: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type ModifierGroupData = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  selectionType: "single" | "multiple";
  minSelections: number;
  maxSelections: number;
  isActive: boolean;
  sortOrder: number;
  options: ModifierOptionData[];
};

export type ModifierSelectionInput = {
  groupId: string;
  options: Array<{ optionId: string; quantity: number }>;
};

export async function loadModifierGroups(sql: Database, productIds: string[], includeInactive = false) {
  if (!productIds.length) return new Map<string, ModifierGroupData[]>();
  const groups = await sql`
    select id, product_id, name, description, selection_type, min_selections, max_selections,
      is_active, sort_order
    from modifier_groups
    where product_id = any(${productIds}::uuid[]) and (${includeInactive} or is_active)
    order by sort_order, name
  `;
  const groupIds = groups.map((group) => String(group.id));
  const options = groupIds.length ? await sql`
    select id, modifier_group_id, name, description, price_delta, included_quantity,
      default_quantity, max_quantity, is_locked, is_active, sort_order
    from modifier_options
    where modifier_group_id = any(${groupIds}::uuid[]) and (${includeInactive} or is_active)
    order by sort_order, name
  ` : [];
  const optionsByGroup = new Map<string, ModifierOptionData[]>();
  for (const option of options) {
    const groupId = String(option.modifierGroupId);
    const list = optionsByGroup.get(groupId) ?? [];
    list.push({
      id: String(option.id), name: String(option.name), description: option.description ? String(option.description) : null,
      priceDelta: String(option.priceDelta), includedQuantity: Number(option.includedQuantity),
      defaultQuantity: Number(option.defaultQuantity), maxQuantity: Number(option.maxQuantity),
      isLocked: Boolean(option.isLocked),
      isActive: Boolean(option.isActive), sortOrder: Number(option.sortOrder),
    });
    optionsByGroup.set(groupId, list);
  }
  const byProduct = new Map<string, ModifierGroupData[]>();
  for (const group of groups) {
    const productId = String(group.productId);
    const list = byProduct.get(productId) ?? [];
    list.push({
      id: String(group.id), productId, name: String(group.name), description: group.description ? String(group.description) : null,
      selectionType: group.selectionType as "single" | "multiple", minSelections: Number(group.minSelections),
      maxSelections: Number(group.maxSelections), isActive: Boolean(group.isActive), sortOrder: Number(group.sortOrder),
      options: optionsByGroup.get(String(group.id)) ?? [],
    });
    byProduct.set(productId, list);
  }
  return byProduct;
}

export function resolveModifierSelection(groups: ModifierGroupData[], selections: ModifierSelectionInput[]) {
  const groupById = new Map(groups.filter((group) => group.isActive).map((group) => [group.id, group]));
  const selectionByGroup = new Map<string, ModifierSelectionInput>();
  for (const selection of selections) {
    if (selectionByGroup.has(selection.groupId) || !groupById.has(selection.groupId)) throw Object.assign(new Error("La configuración del producto ya no es válida."), { statusCode: 409 });
    selectionByGroup.set(selection.groupId, selection);
  }

  let modifierCents = 0;
  const snapshot: Array<{ groupId: string; groupName: string; optionId: string; optionName: string; quantity: number; includedQuantity: number; isLocked: boolean; unitPriceDeltaCents: number; chargedQuantity: number; totalDeltaCents: number }> = [];
  for (const group of groupById.values()) {
    const selected = (selectionByGroup.get(group.id)?.options ?? []).filter((option) => option.quantity > 0);
    const selectedByOption = new Map(selected.map((option) => [option.optionId, option]));
    for (const lockedOption of group.options.filter((option) => option.isActive && option.isLocked)) {
      if ((selectedByOption.get(lockedOption.id)?.quantity ?? 0) < lockedOption.defaultQuantity) throw Object.assign(new Error(`“${lockedOption.name}” es un ingrediente fijo y no se puede quitar.`), { statusCode: 409 });
    }
    const optionIds = new Set<string>();
    if (selected.length < group.minSelections || selected.length > group.maxSelections) throw Object.assign(new Error(`Revisa la selección “${group.name}”.`), { statusCode: 409 });
    if (group.selectionType === "single" && selected.length > 1) throw Object.assign(new Error(`Selecciona solo una opción en “${group.name}”.`), { statusCode: 409 });
    const optionById = new Map(group.options.filter((option) => option.isActive).map((option) => [option.id, option]));
    for (const selectedOption of selected) {
      if (optionIds.has(selectedOption.optionId)) throw Object.assign(new Error(`Hay una opción repetida en “${group.name}”.`), { statusCode: 409 });
      optionIds.add(selectedOption.optionId);
      const option = optionById.get(selectedOption.optionId);
      if (!option || selectedOption.quantity > option.maxQuantity || (group.selectionType === "single" && selectedOption.quantity !== 1)) throw Object.assign(new Error(`Revisa una opción de “${group.name}”.`), { statusCode: 409 });
      const unitPriceDeltaCents = Math.round(Number(option.priceDelta) * 100);
      const chargedQuantity = Math.max(0, selectedOption.quantity - option.includedQuantity);
      const totalDeltaCents = chargedQuantity * unitPriceDeltaCents;
      modifierCents += totalDeltaCents;
      snapshot.push({ groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, quantity: selectedOption.quantity, includedQuantity: option.includedQuantity, isLocked: option.isLocked, unitPriceDeltaCents, chargedQuantity, totalDeltaCents });
    }
  }
  return { modifierCents, snapshot };
}
