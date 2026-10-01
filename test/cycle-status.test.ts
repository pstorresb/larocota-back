import { describe, expect, it } from "vitest";
import { cycleUpdateSchema } from "../src/modules/admin/routes.js";
import { assertCycleTransition, canCycleTransition, cycleStatuses, cycleTransitions } from "../src/modules/cycles/cycle-status.js";

describe("cycle update schema", () => {
  it("leaves every omitted field undefined so a status-only change touches nothing else", () => {
    const parsed = cycleUpdateSchema.safeParse({ status: "scheduled" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ status: "scheduled" });
  });

  it("still accepts explicit nulls to clear capacities and rejects an empty patch", () => {
    const parsed = cycleUpdateSchema.safeParse({ slotCapacity: null, globalCapacity: null });
    expect(parsed.success && parsed.data).toEqual({ slotCapacity: null, globalCapacity: null });
    expect(cycleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("cycle status transitions", () => {
  it("follows the publishing path draft → scheduled → open → closed → fulfilled", () => {
    expect(canCycleTransition("draft", "scheduled")).toBe(true);
    expect(canCycleTransition("scheduled", "open")).toBe(true);
    expect(canCycleTransition("open", "closed")).toBe(true);
    expect(canCycleTransition("closed", "fulfilled")).toBe(true);
  });

  it("lets a scheduled cycle go back to draft and a closed one reopen, but never revives a finished one", () => {
    expect(canCycleTransition("scheduled", "draft")).toBe(true);
    expect(canCycleTransition("closed", "open")).toBe(true);
    expect(canCycleTransition("open", "scheduled")).toBe(false);
    for (const status of cycleStatuses) {
      expect(cycleTransitions("fulfilled")).not.toContain(status);
      expect(cycleTransitions("cancelled")).not.toContain(status);
    }
  });

  it("explains a rejected transition in Spanish with a stable code", () => {
    expect(() => assertCycleTransition("open", "draft")).toThrow(/«Abierto» a «Borrador»/);
    try {
      assertCycleTransition("draft", "open");
    } catch (error) {
      expect((error as { statusCode?: number; code?: string }).statusCode).toBe(400);
      expect((error as { code?: string }).code).toBe("INVALID_TRANSITION");
    }
  });
});
