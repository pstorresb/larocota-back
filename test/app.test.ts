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

  it("formats domain errors thrown inside encapsulated plugins with their own code", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
    await app.register(async (child) => {
      child.get("/boom", async () => { throw Object.assign(new Error("Esa franja ya está llena."), { statusCode: 409, code: "SLOT_FULL" }); });
      child.get("/plain", async () => { throw Object.assign(new Error("Sin cupos."), { statusCode: 409 }); });
      child.get("/pg", async () => { throw Object.assign(new Error("duplicate key"), { statusCode: 409, code: "23505" }); });
    }, { prefix: "/plugin" });
    expect((await app.inject({ method: "GET", url: "/plugin/boom" })).json()).toMatchObject({ code: "SLOT_FULL", message: "Esa franja ya está llena." });
    expect((await app.inject({ method: "GET", url: "/plugin/plain" })).json()).toMatchObject({ code: "REQUEST_ERROR", message: "Sin cupos." });
    expect((await app.inject({ method: "GET", url: "/plugin/pg" })).json().code).toBe("REQUEST_ERROR");
  });

  it("asks for a session before validating a checkout", async () => {
    app = await buildApp(loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" }));
    const response = await app.inject({ method: "POST", url: "/api/v1/orders", payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_REQUIRED");
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
