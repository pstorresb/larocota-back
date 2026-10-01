/**
 * Prices are final consumer prices: the tax is already inside them.
 * `unitBaseCents` and `modifierCents` are what the customer pays per unit; tax is the included share.
 */
export type MoneyLine = {
  unitBaseCents: number;
  modifierCents: number;
  quantity: number;
  taxRateBps: number;
};

export function calculateLine(line: MoneyLine) {
  const unitCents = line.unitBaseCents + line.modifierCents;
  const totalCents = unitCents * line.quantity;
  // Tax contained in a tax-inclusive amount: total × rate / (1 + rate), in basis points.
  const taxCents = Math.round((totalCents * line.taxRateBps) / (10_000 + line.taxRateBps));
  return { unitCents, subtotalCents: totalCents - taxCents, taxCents, totalCents };
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
