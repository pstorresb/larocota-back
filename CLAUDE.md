# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # tsx watch src/server.ts (port 4000 by default)
npm run typecheck    # tsc --noEmit — the closest thing to a linter here
npm run build        # tsc -> dist/ ; npm start runs dist/src/server.js
npm test             # vitest run (no database required)
npm run migrate      # apply pending migrations/*.sql
npm run seed         # upsert the superadmin from SEED_SUPERADMIN_* env vars
npm run seed:demo    # demo catalog + sales cycle + product images
```

Single test file / single test:

```bash
npx vitest run test/money.test.ts
npx vitest run -t "rejects an empty quote"
```

Setup: copy `.env.example` to `.env`, create the Postgres database, then `npm run migrate && npm run seed`. `src/server.ts` and every script call `process.loadEnvFile()`, so `.env` is read automatically without dotenv.

The Next.js frontend lives in the sibling repo `../larocota-front` (also a configured working directory). It talks to this API via `NEXT_PUBLIC_API_URL` and relies on the session cookie, so CORS `FRONTEND_ORIGIN` must match its origin exactly.

## Architecture

Fastify 5 + raw SQL over `postgres` (postgres.js) + Zod. No ORM, no DI container, no repository layer — route handlers own their SQL.

**Composition.** `src/app.ts:buildApp(env)` is the single wiring point: it creates the `sql` client, registers plugins (helmet, cors, cookie, rate-limit, multipart), health endpoints, and each module's routes under `/api/v1`. Every module exports a *factory* `xRoutes(sql, env): FastifyPluginAsync` — dependencies are captured in the closure, never read from `app.decorate` or globals. Tests build a fresh app with `buildApp(loadEnv({ NODE_ENV: "test", ... }))` and use `app.inject`.

**ESM + NodeNext.** Relative imports must carry the `.js` extension even in `.ts` sources (`import { buildApp } from "./app.js"`). `strict` and `noUncheckedIndexedAccess` are on.

**Database conventions.** The client is created with `transform: postgres.camel`, so SQL is written in `snake_case` and results come back `camelCase`. Postgres `numeric` columns arrive as *strings*; array/uuid params need explicit casts (`= any(${ids}::uuid[])`). Multi-statement writes go through `sql.begin(async (tx) => …)` and use `for update` row locks where capacity is checked.

**Money.** Never do float arithmetic on prices. Prices/tax rates live in the DB as numeric strings; code converts to integer cents (`Math.round(Number(x) * 100)`) and tax rates to basis points (`* 10_000`) as early as possible, computes in cents (`src/common/money.ts`), and converts back to a 2-decimal string only when writing to Postgres.

**Errors.** Handlers throw `Object.assign(new Error("mensaje"), { statusCode: 409 })`. The global handler in `app.ts` turns anything `< 500` into `{ code: "REQUEST_ERROR", message, requestId }` and masks 5xx. Validation uses `schema.safeParse` and replies `400 { code: "VALIDATION_ERROR", message, details }` directly. **All user-facing `message` strings are Spanish**; `code` values are stable English SCREAMING_SNAKE identifiers the frontend branches on.

**Migrations** are forward-only numbered SQL files in `migrations/`. `scripts/migrate.ts` records applied filenames in `schema_migrations` and runs each file inside a transaction. Never edit an applied migration — add a new one.

## Domain model

**Sales cycles** are the organizing concept: the shop isn't always open. A `sales_cycles` row has `opens_at` / `closes_at` / `fulfillment_at`, a status enum, allowed `fulfillment_modes`, and an optional `global_capacity`. Products only become buyable by being joined to a cycle via `cycle_products` (which carries per-cycle `capacity`, `price_override`, `is_available`). `GET /api/v1/catalog` serves the single active (`open`, else next `scheduled`) cycle.

**Stock** is tracked in `stock_reservations` per (cycle, product, order). Availability = capacity minus the sum of `reserved` + `committed` reservations; `submitOrder` re-checks both cycle-level and product-level capacity under `for update` before inserting.

**Product configuration (modifiers).** `modifier_groups` → `modifier_options`, with per-option `included_quantity` (free units), `default_quantity`, `max_quantity`, and `is_locked` (fixed ingredient that cannot be removed). `src/modules/catalog/configuration.ts` is the shared authority: `loadModifierGroups` reads them and `resolveModifierSelection` validates a customer's selection and returns `{ modifierCents, snapshot }`. Both `/orders/quote` and checkout call it, so pricing rules exist in exactly one place — change them there, not in a route.

**Order snapshots.** Orders freeze what was bought: `contact_snapshot`, `address_snapshot`, `product_name_snapshot`, `snapshot_json` (modifiers + tax rate) on each item. Later catalog edits must never alter a placed order.

**Order lifecycle** is a table-driven state machine in `src/modules/orders/state-machine.ts`; `assertTransition` guards every admin status change. There is no payment gateway — customers upload a bank-transfer proof (`POST /orders/:orderId/payment-proof`), which supersedes any prior proof and moves the order to `payment_review`; an admin approves/rejects it. Every transition appends to `order_status_history`, and customer-visible statuses trigger a Resend email.

## Auth & authorization

Opaque 32-byte session tokens in an httpOnly cookie; only the SHA-256 hash is stored in `sessions`. `getSessionUser` (`src/modules/auth/session.ts`) joins session→user and enforces `status = 'active'` and non-expiry — every protected handler calls it explicitly; there is no global auth hook.

Three roles (`customer`, `admin`, `superadmin`). `src/modules/admin/routes.ts` defines `requireAdmin` / `requireSuperadmin` (user management is superadmin-only, with a self-lockout guard) — call these at the top of any new admin handler.

Passwords use argon2id (`memoryCost: 19_456, timeCost: 2, parallelism: 1` — keep these consistent across register, seed, and admin user creation). Signup and password recovery both use hashed 6-digit PINs with send throttling, attempt limits and expiry, compared with `timingSafeEqual`. Google sign-in verifies the OIDC `id_token` against Google's JWKS via `jose`, with a state cookie scoped to `/api/v1/auth/google`.

Sensitive routes set per-route rate limits via `{ config: { rateLimit: { max, timeWindow } } }` on top of the global 120/min.

## File uploads

Files go to the local filesystem under `UPLOAD_DIR` (`media/products`, `media/payment-proofs`), not object storage; only the key is stored in Postgres. MIME type is detected from the buffer with `file-type` and checked against an allowlist — never trust the client-supplied extension. Product images are public and cached; payment proofs are served through an authorizing route (`no-store`, owner-or-admin only). If a DB write fails after a proof is written, the file is unlinked.

## Auditing

Every admin mutation inserts into `audit_events` with `actor_user_id`, `request.id`, entity type/id, action, and `before_json`/`after_json`. Match this when adding admin endpoints, and put the audit insert inside the same transaction as the change when one is used.
