import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

describe("environment", () => {
  it("defaults to trusting the proxy and a 24-hour payment window", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.PAYMENT_WINDOW_HOURS).toBe(24);
    expect(env.MAINTENANCE_INTERVAL_SECONDS).toBe(60);
  });

  it("lets TRUST_PROXY be switched off explicitly", () => {
    expect(loadEnv({ NODE_ENV: "test", TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
  });

  it("refuses to start in production without an explicit database and frontend origin", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL, FRONTEND_ORIGIN/);
    expect(() => loadEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@db:5432/larocota", FRONTEND_ORIGIN: "https://larocota.com" })).not.toThrow();
  });
});
