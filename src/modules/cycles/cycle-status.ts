export const cycleStatuses = ["draft", "scheduled", "open", "closed", "fulfilled", "cancelled"] as const;

export type CycleStatus = (typeof cycleStatuses)[number];

export const cycleStatusLabels: Record<CycleStatus, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  open: "Abierto",
  closed: "Cerrado",
  fulfilled: "Cumplido",
  cancelled: "Cancelado",
};

/**
 * Admin-driven transitions. The maintenance job also moves scheduled → open → closed by dates;
 * "open" from "scheduled" here is the manual "abrir ahora" override.
 */
const allowed: Record<CycleStatus, readonly CycleStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["draft", "open", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export function cycleTransitions(from: CycleStatus): readonly CycleStatus[] {
  return allowed[from];
}

export function canCycleTransition(from: CycleStatus, to: CycleStatus) {
  return allowed[from].includes(to);
}

export function assertCycleTransition(from: CycleStatus, to: CycleStatus) {
  if (canCycleTransition(from, to)) return;
  throw Object.assign(
    new Error(`No se puede pasar el ciclo de «${cycleStatusLabels[from]}» a «${cycleStatusLabels[to]}».`),
    { statusCode: 400, code: "INVALID_TRANSITION" },
  );
}
