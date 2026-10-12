# Agent Instructions

## 1. Before Starting

- Read this file and `PROJECT_STATUS.md` before making changes.
- Inspect the current branch, working tree, and latest commit before editing.
- Review the relevant source files and existing tests. Do not assume previous chat context is current.
- Briefly state the problem, evidence, proposed change, and verification plan before significant work.
- Preserve unrelated user changes. Never discard or overwrite them without permission.

## 2. Approval Checkpoints

Get explicit approval before:

- Destructive database operations or production-data changes.
- Database schema migrations against a shared or production database.
- Production deployments, merging pull requests, or changing production configuration.
- Broad refactors, dependency replacements, or security-sensitive architectural changes outside the agreed scope.

Routine, narrowly scoped changes may proceed once the task is clear.

## 3. Debugging Discipline

- Start with the observed behavior and concrete evidence.
- State the current hypothesis before testing it.
- Change one relevant variable at a time whenever practical.
- Do not repeat a test unless the inputs, environment, code, or hypothesis have changed.
- Separate confirmed facts from assumptions.
- Check application behavior, HTTP status, response body, logs, and relevant dependencies.
- A successful build or deployment status alone does not prove an endpoint works.
- After a failed test, explain what it establishes and choose the next test based on that evidence.
- Stop and reassess when repeated attempts produce no new information.

## 4. Code Quality and Scope

- Follow the existing project architecture and established conventions.
- Prefer small, maintainable changes over unnecessary rewrites.
- Avoid unrelated edits, duplicate abstractions, and speculative fixes.
- Consider validation, authorization, error handling, database consistency, and regression tests when relevant.
- Never weaken security checks or skip tests just to make a deployment pass.
- Do not claim a test passed unless it was actually run and its result was checked.

## 5. Security and Secrets

- Never print, commit, or expose passwords, API keys, tokens, connection strings, or secret environment values.
- Do not run verbose commands that may expose authentication headers or tokens.
- Keep secrets in the appropriate environment configuration, not in source code or documentation.
- Do not change CORS, authentication, authorization, or other security settings merely to bypass an error.
- Redact secrets from logs and reports.

## 6. Tests and Verification

- Inspect available scripts in `package.json` before choosing commands.
- Run the most relevant tests and build for the scope of the change.
- For API changes, verify real HTTP behavior when the environment permits.
- For production CRUD smoke tests, use clearly identifiable temporary data and verify cleanup.
- Do not modify real user data during testing.
- If a test cannot be run, state why and what remains unverified.

## 7. Deployment and Git

- Check the target branch and deployment environment before making deployment-related changes.
- Keep unrelated fixes and experiments in separate branches or commits.
- Do not merge or deploy to production without the required approval.
- Diagnose deployment-platform failures separately from application-code failures.
- Report the commit SHA, deployment target, tests run, and observed results when relevant.

## 8. Completion Report

At the end of each task, report:

1. What changed and why.
2. Files changed.
3. Commands and tests run, with actual outcomes.
4. Remaining risks or unverified behavior.
5. Whether `PROJECT_STATUS.md` needs an update.

Update `PROJECT_STATUS.md` when a significant verified change affects architecture, deployment, test coverage, or known issues. Never put secret values in it.
