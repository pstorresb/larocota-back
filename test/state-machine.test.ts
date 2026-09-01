import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../src/modules/orders/state-machine.js";

describe("order state machine", () => {
  it("allows the audited production path", () => expect(canTransition("confirmed", "in_preparation")).toBe(true));
  it("rejects skipping directly to delivered", () => expect(() => assertTransition("payment_review", "delivered")).toThrow());
});
