import { describe, expect, it } from "vitest";
import { buildSlots, findSlot, isValidSlot } from "../src/modules/cycles/slots.js";

// Friday 11:30–14:00 in Ecuador (UTC-5) is 16:30–19:00 UTC.
const window = { fulfillmentStartsAt: "2026-10-09T16:30:00.000Z", fulfillmentEndsAt: "2026-10-09T19:00:00.000Z", slotMinutes: 30 };

describe("fulfillment slots", () => {
  it("splits the window into consecutive slots", () => {
    const slots = buildSlots(window);
    expect(slots).toHaveLength(5);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-10-09T16:30:00.000Z");
    expect(slots[0]?.endsAt.toISOString()).toBe("2026-10-09T17:00:00.000Z");
    expect(slots[4]?.endsAt.toISOString()).toBe("2026-10-09T19:00:00.000Z");
  });

  it("supports a 60-minute grid and accepts Date inputs", () => {
    const slots = buildSlots({ fulfillmentStartsAt: new Date("2026-10-09T16:00:00.000Z"), fulfillmentEndsAt: new Date("2026-10-09T19:00:00.000Z"), slotMinutes: 60 });
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual(["2026-10-09T16:00:00.000Z", "2026-10-09T17:00:00.000Z", "2026-10-09T18:00:00.000Z"]);
  });

  it("drops a trailing partial slot instead of overflowing the window", () => {
    expect(buildSlots({ ...window, fulfillmentEndsAt: "2026-10-09T18:45:00.000Z" })).toHaveLength(4);
  });

  it("finds a slot only when the start matches the grid exactly", () => {
    expect(findSlot(window, "2026-10-09T17:30:00.000Z")?.endsAt.toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(findSlot(window, "2026-10-09T17:30:00-05:00")).toBeNull();
    expect(findSlot(window, "2026-10-09T17:45:00.000Z")).toBeNull();
    expect(findSlot(window, "2026-10-09T19:00:00.000Z")).toBeNull();
    expect(findSlot(window, "2026-10-09T16:00:00.000Z")).toBeNull();
    expect(isValidSlot(window, "not a date")).toBe(false);
  });

  it("accepts the same instant written with an offset", () => {
    expect(isValidSlot(window, "2026-10-09T11:30:00-05:00")).toBe(true);
  });
});
