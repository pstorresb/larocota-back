import { describe, expect, it } from "vitest";
import { assertCycleTransition, canCycleTransition, cycleStatuses, cycleTransitions } from "../src/modules/cycles/cycle-status.js";

describe("cycle status transitions", () => {
  it("follows the publishing path draft → scheduled → open → closed → fulfilled", () => {
    expect(canCycleTransition("draft", "scheduled")).toBe(true);
    expect(canCycleTransition("scheduled", "open")).toBe(true);
    expect(canCycleTransition("open", "closed")).toBe(true);
    expect(canCycleTransition("closed", "fulfilled")).toBe(true);
  });

  it("lets a scheduled cycle go back to draft but never reopens a finished one", () => {
    expect(canCycleTransition("scheduled", "draft")).toBe(true);
    expect(canCycleTransition("closed", "open")).toBe(false);
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
