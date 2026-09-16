# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # tsx watch src/server.ts (port 4000 by default)
npm run typecheck    # tsc --noEmit — the closest thing to a linter here
npm run build        # tsc -> dist/ ; npm start runs dist/src/server.js
npm test             # vitest run (no database required — see Testing)
npm run migrate      # apply pending migrations/*.sql
npm run seed         # upsert the superadmin from SEED_SUPERADMIN_* env vars
npm run seed:demo    # demo catalog + sales cycle + product images
npm run maintenance  # one-off run of the housekeeping job (cycle open/close, expired reservations, purge)
```

Single test file / single test:

```bash
npx vitest run test/money.test.ts
npx vitest run -t "rejects an empty quote"
```

Setup: copy `.env.example` to `.env`, create the Postgres database (`docker compose up -d db` from this repo or the workspace root), then `npm run migrate && npm run seed`. `src/server.ts` and every script call `process.loadEnvFile()`, so `.env` is read automatically without dotenv. `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` are validated in `scripts/seed.ts`, not in `src/config/env.ts`.

The Next.js frontend lives in the sibling repo `../larocota-front` (a separate git repository with its own `CLAUDE.md`; when Claude is started from the parent folder `larocota/` both repos are visible). It talks to this API via `NEXT_PUBLIC_API_URL` and relies on the session cookie, so CORS `FRONTEND_ORIGIN` must match its origin exactly.

There is no linter or formatter in this repo (`npm run typecheck` is the only static gate) and no CI. Existing files use very long single-line statements; that is debt, not a convention — write new code in conventional multi-line style.

## Testing

`test/app.test.ts` builds the real app with `buildApp(loadEnv({ NODE_ENV: "test" }))` and uses `app.inject`. It needs no database only because postgres.js opens a connection lazily and the two HTTP tests never reach a query (`/health` runs no SQL; the empty quote fails Zod before SQL). Any new test that hits a DB-backed route will need a real Postgres (e.g. `DATABASE_URL` pointing at a scratch database) — there are no mocks. `money`, `state-machine` and `catalog/configuration` have pure unit tests; `orders/service.ts`, payments, auth and admin routes currently have none.

## Architecture

Fastify 5 + raw SQL over `postgres` (postgres.js) + Zod. No ORM, no DI container, no repository layer — route handlers own their SQL.

**Composition.** `src/app.ts:buildApp(env)` is the single wiring point: it creates the `sql` client, registers plugins (helmet, cors, cookie, rate-limit, multipart), health endpoints (`/health` and `/ready` sit **outside** the `/api/v1` prefix; nginx only proxies `/health`), and each module's routes under `/api/v1` (`auth`, `catalog`, `orders`, `payments`, `settings`, `admin`). `trustProxy` comes from `TRUST_PROXY` (default `true`) so rate limits key on the real client IP behind nginx; `/media/products/:key` opts out of the global limit with `config.rateLimit: false`. `src/server.ts` handles SIGTERM/SIGINT (`app.close()` with a 10 s force-exit) and starts the maintenance job.

**Auth guards.** `requireAdmin` / `requireSuperadmin` live in `src/modules/auth/guards.ts`; import them rather than re-implementing the check.

**Maintenance job.** `src/jobs/maintenance.ts:runMaintenance` runs every `MAINTENANCE_INTERVAL_SECONDS` (default 60, `0` disables) and on demand via `npm run maintenance`. It moves cycles `scheduled → open → closed` by their dates, cancels `payment_pending` orders whose reservation `expires_at` passed (releases stock, writes history + audit with actor `null`, emails the customer), and purges expired sessions and one-time codes. Every step is idempotent.

**Store settings.** `store_settings` is a key/value table (`payment`, `pickup`) validated by `src/modules/settings/schema.ts`. `GET /settings/public` is what the storefront reads: `payment` is `null` until `enabled` is true and never includes `holderIdentifier`; `pickup` is `null` until an address exists. `GET /admin/settings` is admin-readable, `PUT /admin/settings/:key` is superadmin-only and audited. Every module exports a *factory* `xRoutes(sql, env): FastifyPluginAsync` — dependencies are captured in the closure, never read from `app.decorate` or globals. Tests build a fresh app with `buildApp(loadEnv({ NODE_ENV: "test", ... }))` and use `app.inject`.

**ESM + NodeNext.** Relative imports must carry the `.js` extension even in `.ts` sources (`import { buildApp } from "./app.js"`). `strict` and `noUncheckedIndexedAccess` are on.

**Database conventions.** The client is created with `transform: postgres.camel`, so SQL is written in `snake_case` and results come back `camelCase`. Postgres `numeric` columns arrive as *strings*; array/uuid params need explicit casts (`= any(${ids}::uuid[])`). Multi-statement writes go through `sql.begin(async (tx) => …)` and use `for update` row locks where capacity is checked.

**Money.** Never do float arithmetic on prices. Prices/tax rates live in the DB as numeric strings; code converts to integer cents (`Math.round(Number(x) * 100)`) and tax rates to basis points (`* 10_000`) as early as possible, computes in cents (`src/common/money.ts`), and converts back to a 2-decimal string only when writing to Postgres.

**Errors.** Handlers throw `Object.assign(new Error("mensaje"), { statusCode: 409 })`. The global handler in `app.ts` turns anything `< 500` into `{ code: "REQUEST_ERROR", message, requestId }` and masks 5xx as `{ code: "INTERNAL_ERROR" }`. Consequence: every thrown domain error (cycle closed, no capacity, invalid modifier) reaches the client as the same `REQUEST_ERROR`; only errors sent explicitly with `reply.code(n).send({ code })` carry a specific code (`AUTH_REQUIRED`, `VALIDATION_ERROR`, `ACCOUNT_EXISTS`, `CODE_EXPIRED`, `ORDER_NOT_FOUND`, `CYCLE_IN_USE`, …). Validation uses `schema.safeParse` and replies `400 { code: "VALIDATION_ERROR", message }`; only the quote, checkout and product-configuration routes also include `details`. **All user-facing `message` strings are Spanish**; `code` values are stable English SCREAMING_SNAKE identifiers. The frontend currently displays `message` and checks `status === 401` only — it does not branch on `code` yet, so adding a code is safe, renaming one is not.

**Migrations** are forward-only numbered SQL files in `migrations/`. `scripts/migrate.ts` records applied filenames in `schema_migrations` and runs each file inside a transaction. Never edit an applied migration — add a new one.

## Domain model

**Sales cycles** are the organizing concept: the shop isn't always open. A `sales_cycles` row has `opens_at` / `closes_at` / `fulfillment_at`, a status enum, allowed `fulfillment_modes`, and an optional `global_capacity`. Products only become buyable by being joined to a cycle via `cycle_products` (which carries per-cycle `capacity`, `price_override`, `is_available`). `GET /api/v1/catalog` serves the `open` cycle whose window contains `now()`, else the next `scheduled` one (returned with `isOpen: false` so the storefront can show "opens on…"). The cycle carries `fulfillmentModes` and `isOpen`. Product `imageUrl` values are returned as `/media/products/<key>` without the `/api/v1` prefix; the frontend prepends it.

**Stock** is tracked in `stock_reservations` per (cycle, product, order). A reservation counts while it is `committed`, or `reserved` with `expires_at` null or in the future. `submitOrder` writes `expires_at = now + PAYMENT_WINDOW_HOURS`; uploading a proof clears it (nothing expires during admin review); rejecting a proof sets a fresh window; the maintenance job cancels what expires. `submitOrder` re-checks both cycle-level and product-level capacity under `for update` before inserting. Use the same "live reservation" predicate in any new availability query.

**Fulfillment.** `fulfillmentType` is `pickup` or `delivery` and must be allowed by the cycle. `address` is required for delivery and stored as `null` for pickup (`checkoutSchema` refines this). Pickup location comes from the `pickup` store setting, not from the order.

**Customer order detail.** `GET /orders/:orderNumber` (owner only) returns items, latest non-superseded proof (with `rejectionReason`), public history and `paymentDeadline`; the confirmation page and the account list use it.

**Product configuration (modifiers).** `modifier_groups` → `modifier_options`, with per-option `included_quantity` (free units), `default_quantity`, `max_quantity`, and `is_locked` (fixed ingredient that cannot be removed). `src/modules/catalog/configuration.ts` is the shared authority: `loadModifierGroups` reads them and `resolveModifierSelection` validates a customer's selection and returns `{ modifierCents, snapshot }`. Both `/orders/quote` and checkout call it, so pricing rules exist in exactly one place — change them there, not in a route.

**Order snapshots.** Orders freeze what was bought: `contact_snapshot`, `address_snapshot`, `product_name_snapshot`, `snapshot_json` (modifiers + tax rate) on each item. Later catalog edits must never alter a placed order.

**Order lifecycle** is a table-driven state machine in `src/modules/orders/state-machine.ts`; `assertTransition` guards every admin status change. There is no payment gateway — customers upload a bank-transfer proof (`POST /orders/:orderId/payment-proof`), which supersedes any prior proof and moves the order to `payment_review`; an admin approves/rejects it. Every transition appends to `order_status_history`. `sendOrderStatusEmail` (`src/common/email/resend.ts`) has copy for `confirmed`, `in_preparation`, `ready`, `out_for_delivery`, `delivered`, `payment_rejected` (includes the rejection reason as `note`) and `cancelled`; `draft`, `payment_pending` and `payment_review` send nothing. A missing `RESEND_API_KEY` makes sending a logged no-op.

## Auth & authorization

Opaque 32-byte session tokens in an httpOnly cookie; only the SHA-256 hash is stored in `sessions`. `getSessionUser` (`src/modules/auth/session.ts`) joins session→user and enforces `status = 'active'`, `revoked_at is null` and non-expiry — every protected handler calls it explicitly; there is no global auth hook. Disabling a user and completing a password reset revoke all of that user's sessions; changing role or email does not.

Three roles (`customer`, `admin`, `superadmin`). `src/modules/admin/routes.ts` defines `requireAdmin` / `requireSuperadmin`. Listing users (`GET /admin/users`) is `requireAdmin`; creating and editing users is superadmin-only, with a self-lockout guard — call these at the top of any new admin handler.

Passwords use argon2id (`memoryCost: 19_456, timeCost: 2, parallelism: 1` — keep these consistent across register, seed, and admin user creation). Signup and password recovery both use hashed 6-digit PINs with send throttling, attempt limits and expiry, compared with `timingSafeEqual`. Google sign-in verifies the OIDC `id_token` against Google's JWKS via `jose`, with a state cookie scoped to `/api/v1/auth/google`.

Sensitive routes set per-route rate limits via `{ config: { rateLimit: { max, timeWindow } } }` on top of the global 120/min.

## File uploads

Files go to the local filesystem under `UPLOAD_DIR` (`media/products`, `media/payment-proofs`), not object storage; only the key is stored in Postgres. MIME type is detected from the buffer with `file-type` and checked against an allowlist — never trust the client-supplied extension. Product images are public and cached; payment proofs are served through an authorizing route (`no-store`, owner-or-admin only). If a DB write fails after a proof is written, the file is unlinked.

## Auditing

Every admin mutation inserts into `audit_events` with `actor_user_id`, `request.id`, entity type/id, action, and `before_json`/`after_json`. Match this when adding admin endpoints, and put the audit insert inside the same transaction as the change when one is used.

## Deployment & ops

Production runs the compiled API (`dist/src/server.js`) and `next start` under PM2 behind nginx, with Postgres 17 from Docker. The versioned templates live in this repo: `deploy/nginx/larocota.conf`, `deploy/env/*.env.example`, `docker-compose.yml`, `ecosystem.config.cjs`; `README.md` has the runbook (migrations, seeds, backups). The parent folder `../` keeps working copies of the same files; keep both in sync.

Things to know before deploying:
- `loadEnv` refuses to start with `NODE_ENV=production` unless `DATABASE_URL` and `FRONTEND_ORIGIN` are set explicitly (they have localhost defaults otherwise).
- `TRUST_PROXY` must stay `true` behind nginx; set it to `false` only if the API is exposed directly.
- `PAYMENT_WINDOW_HOURS` (default 24) and `MAINTENANCE_INTERVAL_SECONDS` (default 60) tune the payment deadline and the housekeeping cadence.
- nginx `client_max_body_size` must stay ≥ `MAX_UPLOAD_BYTES` plus multipart overhead.
- Schema tables `bank_accounts`, `documents` and `product_components` exist but are not referenced by any code (`store_settings.payment` replaced `bank_accounts`).

The prioritized improvement plan (production blockers first) is in `docs/roadmap.md`; product decisions and open questions are in `docs/decisions.md`.
