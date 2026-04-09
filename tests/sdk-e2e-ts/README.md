# @superserve/test-sdk-e2e-ts

End-to-end test for `@superserve/sdk` against a live Superserve environment. Creates a real sandbox, runs a command, deletes the sandbox, verifies everything worked.

Imports the SDK directly from `packages/sdk/src` via tsconfig `paths` — no build step, no `dist/` indirection. Source changes are picked up on the next run.

**Not wired into `bun run test`.** This test is credentialed, slow, and hits real infrastructure — it would break CI on every commit. Invoke explicitly when you want to validate the SDK against a live environment.

## Run

Defaults to **staging** (`https://api-staging.superserve.ai`):

```bash
cd tests/sdk-e2e-ts
SUPERSERVE_API_KEY=ss_... bun run e2e
```

Or from the repo root:

```bash
SUPERSERVE_API_KEY=ss_... bun run test:e2e
```

## Target a different environment

Set `SUPERSERVE_BASE_URL` to override the default:

```bash
# production
SUPERSERVE_API_KEY=ss_live_... \
SUPERSERVE_BASE_URL=https://api.superserve.ai \
  bun run e2e

# local dev server
SUPERSERVE_API_KEY=ss_dev_... \
SUPERSERVE_BASE_URL=http://localhost:8080 \
  bun run e2e
```

## Expected output

```
Target: https://api-staging.superserve.ai

Creating sandbox...
  id: sbx_abc123...
  status: starting

Running command: uname -a && date

--- stdout ---
Linux <hostname> ...
Fri Apr 10 00:00:00 UTC 2026
--- exit code: 0 ---

Deleting sandbox sbx_abc123...
Done.
```

## Typecheck

```bash
bun run typecheck
```

Uses tsconfig `paths` to resolve `@superserve/sdk` to `../../packages/sdk/src/index.ts`. Catches regressions in the SDK's public types without needing the `dist/` build.

## Why this is separate from the CI test pipeline

Two reasons:

1. **Credentials.** This test needs a real API key. Running it on every PR would generate load on staging and cost money even if the key were in a CI secret.
2. **Speed.** Creating + deleting a sandbox takes multiple seconds. The regular `test` task is sub-second; we want to keep it that way.

Recommended invocation patterns:

- **Manually** before a release, to verify the SDK works against production
- **Scheduled CI** (e.g., a GitHub Actions cron job) running against staging nightly to catch backend-SDK drift
- **On-demand CI** via `workflow_dispatch` for debugging

To wire up a scheduled workflow, add a `.github/workflows/sdk-e2e.yml` with a `schedule:` trigger and `secrets.SUPERSERVE_API_KEY` plumbed in. Not included in this repo by default — add it when you have a real environment to hit.
