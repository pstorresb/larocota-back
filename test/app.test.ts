import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

// These tests never reach a SQL query, which is the only reason they run without a database.
describe("HTTP API", () => {
  it("exposes a process healthcheck without leaking configuration", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "larocota-api" });
  });

  it("rejects an empty quote before consulting the catalog", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
    const response = await app.inject({ method: "POST", url: "/api/v1/orders/quote", payload: { cycleId: "00000000-0000-4000-8000-000000000001", items: [] } });
    expect(response.statusCode).toBe(400);
  });

  it("derives the client address from X-Forwarded-For when the proxy is trusted", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", TRUST_PROXY: "true" }));
    app.get("/whoami", async (request) => ({ ip: request.ip }));
    const response = await app.inject({ method: "GET", url: "/whoami", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(response.json()).toEqual({ ip: "203.0.113.7" });
  });

  it("ignores X-Forwarded-For when the proxy is not trusted", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", TRUST_PROXY: "false" }));
    app.get("/whoami", async (request) => ({ ip: request.ip }));
    const response = await app.inject({ method: "GET", url: "/whoami", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(response.json().ip).not.toBe("203.0.113.7");
  });
});
