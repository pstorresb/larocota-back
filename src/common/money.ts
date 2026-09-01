export type MoneyLine = {
  unitBaseCents: number;
  modifierCents: number;
  quantity: number;
  taxRateBps: number;
};

export function calculateLine(line: MoneyLine) {
  const unitCents = line.unitBaseCents + line.modifierCents;
  const subtotalCents = unitCents * line.quantity;
  const taxCents = Math.round((subtotalCents * line.taxRateBps) / 10_000);
  return { unitCents, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function calculateOrder(lines: MoneyLine[]) {
  return lines.reduce(
    (total, line) => {
      const value = calculateLine(line);
      total.subtotalCents += value.subtotalCents;
      total.taxCents += value.taxCents;
      total.totalCents += value.totalCents;
      return total;
    },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
}
