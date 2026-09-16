import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";
import { runMaintenance } from "../src/jobs/maintenance.js";

vi.mock("../src/common/email/resend.js", () => ({ sendOrderStatusEmail: vi.fn() }));

describe("reservation expiry", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function database(status: string, expired: boolean) {
    const writes: string[] = [];
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const statement = parts.join("?").replace(/\s+/g, " ").trim();
      if (statement.startsWith("select distinct o.id")) {
        expect(statement).toContain("'payment_rejected'");
        return [{ id: "order-1" }];
      }
      if (statement.startsWith("select id, status, order_number")) return [{
        id: "order-1", status, orderNumber: "ROC-TEST", fulfillmentType: "pickup",
        contactSnapshot: { email: "test@example.com", firstName: "Test" },
      }];
      if (statement.startsWith("select id from stock_reservations")) return expired ? [{ id: "reservation-1" }] : [];
      if (statement.startsWith("update orders")) writes.push(statement);
      return [];
    });
    const sql = Object.assign(query, {
      begin: async (callback: (tx: unknown) => Promise<unknown>) => callback(sql),
      json: (value: unknown) => value,
    });
    return { sql: sql as unknown as Database, writes };
  }

  it("cancels a rejected payment after its renewed deadline", async () => {
    const { sql, writes } = database("payment_rejected", true);
    const report = await runMaintenance(sql, loadEnv({ NODE_ENV: "test" }), log);
    expect(report.ordersExpired).toBe(1);
    expect(writes).toHaveLength(1);
  });

  it("preserves an order whose proof arrived before the order lock", async () => {
    const { sql, writes } = database("payment_review", false);
    const report = await runMaintenance(sql, loadEnv({ NODE_ENV: "test" }), log);
    expect(report.ordersExpired).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("rechecks the deadline after obtaining the order lock", async () => {
    const { sql, writes } = database("payment_rejected", false);
    const report = await runMaintenance(sql, loadEnv({ NODE_ENV: "test" }), log);
    expect(report.ordersExpired).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
