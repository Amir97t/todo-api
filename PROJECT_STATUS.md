# Project Status

_Last verified: 2026-10-12_

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

## Working Rules

- Read `AGENTS.md` before development work.
- Claude should also read `CLAUDE.md`.
- Re-test production only when needed and avoid repetitive checks that provide no new evidence.
- Never store secrets, tokens, credentials, or real environment-variable values in this file.

## Next Action

- Investigate the automatic deployment `git_info_fail` only if it recurs or remains unresolved.
- Confirm current deployment and Git status before making deployment-related changes.
