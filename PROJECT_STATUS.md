# Project Status

_Last verified: 2026-10-12 05:15 UTC (production deployment and API smoke checks)_

## Project

- Repository: `Amir97t/todo-api`
- Stack: NestJS, Prisma, PostgreSQL (Neon), Vercel
- Production API: `https://tasknote-api.vercel.app`

## Confirmed Production Status

- Latest checked Git-connected production deployment is `READY` and was created from `main` at commit `1460202c2f4be22be206188d719f88f21c4e5d14`.
- The deployment is sourced from GitHub (`Amir97t/todo-api`) and has the production alias `tasknote-api.vercel.app`.
- `GET /api/v1/health` returned HTTP 200 at 2026-10-12 05:15 UTC. The response reported application status `ok`, database status `up`, and database latency of about 666 ms.
- `GET /api/v1/lists` returned HTTP 200 at 2026-10-12 05:15 UTC and included the Inbox list.
- A previous production CRUD smoke test successfully created a temporary task, updated its completion state, and deleted it. The temporary task was deleted.
- The production runtime-error query for the preceding 24 hours returned no runtime errors at the time of this check.
- The production fix for NestJS bootstrap invocation replaced top-level `await bootstrap()` with a handled `bootstrap().catch(...)` invocation. Fix merged through PR #1, merge commit `7ab2f3e9747aa027adae0cb2f5012ab9653c0043`.

## Deployment Follow-up

- An earlier automatic deployment attempt reported `git_info_fail`; a manual deployment from the merged GitHub commit succeeded.
- On 2026-10-12, merging PR #2 triggered a new Git-sourced production deployment from `main`, and the deployment reached `READY`. The earlier `git_info_fail` did not recur during this check.
- Treat `git_info_fail` as a historical/intermittent issue, not evidence that the current API is broken. Investigate again if an automatic deployment fails in the future.
- Do not mark an endpoint as verified unless it has been tested directly and its response checked.

## Working Rules

- Read `AGENTS.md` and `PROJECT_STATUS.md` before development work.
- Claude should also read `CLAUDE.md`.
- Re-test production only when needed and avoid repetitive checks that provide no new evidence.
- Never store secrets, tokens, credentials, or real environment-variable values in this file.

## Next Action

- Continue API/frontend integration work.
- When the frontend is connected, verify its actual production API calls end to end.
- Revisit the Vercel Git integration issue only if an automatic deployment failure recurs.
- Confirm current deployment and Git status before making deployment-related changes.
