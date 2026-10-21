# Project Status

_Last verified: 2026-10-16 (Iran time)_

## Project

- Repository: `Amir97t/todo-api`
- Stack: NestJS, Prisma, PostgreSQL (Neon), Vercel
- Production API: `https://tasknote-api.vercel.app`

## Confirmed Production Status

- `GET /api/v1/health` returned HTTP 200, with the database reported as up.
- `GET /api/v1/lists` returned HTTP 200 and included the Inbox list.
- A production CRUD smoke test successfully created a temporary task, updated its completion state, and deleted it.
- The temporary smoke-test task was deleted.
- The successful deployment included the NestJS bootstrap change that replaced top-level `await bootstrap()` with a handled `bootstrap().catch(...)` invocation.
- Fix merged through PR #1. Merge commit: `7ab2f3e9747aa027adae0cb2f5012ab9653c0043`.

## Known Follow-up

- A Vercel automatic deployment attempt reported `git_info_fail`. A manual deployment from the merged GitHub commit succeeded.
- Treat automatic deployment integration as a separate follow-up. Do not assume the production API is currently broken because of that earlier deployment error.
- Do not mark an endpoint as verified unless it has been tested directly and its response checked.

## Local Development State (uncommitted working tree)

- Working tree on `feat/auth-foundation-checkpoint-1` contains Checkpoints 1–3, C4-A auth hardening, C4-1a+C4-1b+C4-2 ownership work, and the C4-3 API contract update, all uncommitted.
- C4-A includes: per-route auth rate limiting (`@nestjs/throttler` with separate IP and HMAC-email buckets; login/register/refresh limits configurable via `RATE_LIMIT*` env vars, default off), Upstash Redis shared-storage provider (fail-closed, 503 `RATE_LIMITER_UNAVAILABLE` on Redis errors, no in-memory fallback when enabled), refresh-token replay and concurrent-refresh race detection with whole-family revocation, and spoof-resistant client-IP bucketing via Express `req.ip` with `trust proxy 1`.
- C4-1a: Prisma `partialIndexes` preview enabled; `List.userId` (nullable), `List.isInbox`, `User.lists` relation (`onDelete: Restrict`); per-user unique `(userId, name)`, partial unique Inbox-per-user `("userId") WHERE "isInbox" = true`, partial unique legacy names `(name) WHERE "userId" IS NULL` (replaces the old global `List_name_key`). Migration `20261014104500_list_ownership` applied and verified on local `todo_dev`. No backfill; legacy Inbox `00000000-0000-4000-8000-000000000001` remains `userId IS NULL`.
- C4-1b+C4-2: registration atomically creates the user's personal Inbox in the same transaction (email unique violation maps to the existing 401). `REQUIRE_AUTH` env (`off`/`enforce`, missing/invalid fails closed to `enforce`, validated at bootstrap, startup log names no values) drives a `ResourceScopeGuard` on lists/tasks/checklist routes that sets typed `req.resourceScope` (`{ userId }` or `{ legacy: true }`); invalid/expired/malformed Bearer tokens always return 401 even in `off` mode (never a silent downgrade). All list/task/checklist queries and mutations (including task create-in-list, task move, and nested checklist access) are scoped through `resourceScope`; cross-user probes return the existing 404 codes; Inbox immutability keys on `isInbox`; delete relocation targets the scope owner's Inbox (created on demand for pre-C4-1b users, race-safe via the partial unique index).
- C4-2 CSRF follow-up: unsafe list/task/checklist mutations (POST/PATCH/PUT/DELETE) run a `ResourceCsrfGuard` after `ResourceScopeGuard` (order: JWT/scope → 401 first, then CSRF → 403). In `enforce` mode it delegates to the existing `CsrfGuard` (allowed Origin + double-submit cookie/header, safe-method skip, error codes `ORIGIN_INVALID`/`CSRF_INVALID`); in `off` mode it is a no-op so the legacy anonymous workflow stays CSRF-free. Auth routes keep `CsrfGuard` unchanged; `CsrfGuard` itself is not modified; a valid CSRF pair never bypasses ownership (cross-user mutations still 404).
- C4-3 API contract: `ListResponse` now includes `isInbox: boolean` (derived from `List.isInbox`); consumers must key Inbox behavior on that flag instead of the fixed ID (`inboxListId` = `lists.find((l) => l.isInbox)?.id ?? null`). Consuming changes are uncommitted in the sibling `todo-app` working tree (`ui-redesign` branch).
- Local `todo_dev` database: all 5 migrations applied (including `20261014104500_list_ownership`). Neon/Production schema untouched.
- Verified locally on 2026-10-15: `npm run lint` (0 issues), `npm run test` (60/60), `npm run test:e2e` (236/236), `npm run build` (success).
- New env vars (names only, placeholders in `.env.example`): `RATE_LIMIT`, `RATE_LIMIT_PROVIDER`, `RATE_LIMIT_LOGIN`, `RATE_LIMIT_REGISTER`, `RATE_LIMIT_REFRESH`, `RATE_LIMIT_HMAC_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REQUIRE_AUTH`. Not set in any deployment; rate limiting is off by default; `REQUIRE_AUTH` not yet set in any environment (backend bootstrap defaults to `enforce` when unset — deployments must set `REQUIRE_AUTH=off` until the frontend sends tokens).
- Deployment staging plan (approved, not executed): backend deploys with `REQUIRE_AUTH=off` → frontend update → enable in Preview → enable in Production.
- Outstanding verification: real-Upstash rate limiting and Vercel Preview checks (C4-A follow-ups); real-browser cookie/CSRF behavior; Neon has neither pending migration applied yet. Frontend live suites (live-auth, live-migration) re-run green (216/216) on the dual-instance `REQUIRE_AUTH`-aware harness.

## Working Rules

- Read `AGENTS.md` before development work.
- Claude should also read `CLAUDE.md`.
- Re-test production only when needed and avoid repetitive checks that provide no new evidence.
- Never store secrets, tokens, credentials, or real environment-variable values in this file.

## Next Action

- Investigate the automatic deployment `git_info_fail` only if it recurs or remains unresolved.
- Confirm current deployment and Git status before making deployment-related changes.
