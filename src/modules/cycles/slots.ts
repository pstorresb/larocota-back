/**
 * Fulfillment slots are computed from a cycle's window, never stored.
 * All arithmetic is on UTC instants; Ecuador has no daylight saving time, so a
 * 30/60-minute grid never shifts. Formatting for display is the caller's job.
 */
export type SlotWindow = {
  fulfillmentStartsAt: Date | string;
  fulfillmentEndsAt: Date | string;
  slotMinutes: number;
};

export type Slot = { startsAt: Date; endsAt: Date };

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function buildSlots(cycle: SlotWindow): Slot[] {
  const start = toDate(cycle.fulfillmentStartsAt).getTime();
  const end = toDate(cycle.fulfillmentEndsAt).getTime();
  const step = cycle.slotMinutes * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0) return [];
  const slots: Slot[] = [];
  for (let at = start; at + step <= end; at += step) {
    slots.push({ startsAt: new Date(at), endsAt: new Date(at + step) });
  }
  return slots;
}

/** Returns the slot that starts exactly at `startsAt`, or null when it is off-grid or outside the window. */
export function findSlot(cycle: SlotWindow, startsAt: Date | string): Slot | null {
  const wanted = toDate(startsAt).getTime();
  if (!Number.isFinite(wanted)) return null;
  return buildSlots(cycle).find((slot) => slot.startsAt.getTime() === wanted) ?? null;
}

export function isValidSlot(cycle: SlotWindow, startsAt: Date | string) {
  return findSlot(cycle, startsAt) !== null;
}
