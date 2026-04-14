# @superserve/test-sdk-e2e-py

End-to-end tests for the `superserve` Python SDK against a live environment. Mirrors the `tests/sdk-e2e-ts/` layout in Python-idiomatic form: one test file per resource, shared fixtures in `conftest.py`, shared helpers in `_helpers.py`, async smoke test in `test_async.py`.

Built with [pytest](https://docs.pytest.org) and [pytest-asyncio](https://pytest-asyncio.readthedocs.io) — the industry standard for Python SDK e2e testing (same as OpenAI, Anthropic, Stripe, etc.).

Imports `superserve` from the uv workspace, which points at `packages/python-sdk/src/superserve` in editable install mode. Source changes in the SDK are picked up on the next `pytest` run with no rebuild needed.

**Not wired into `bun run test`.** These tests are credentialed, slow, and create real cloud resources. They run only when explicitly invoked.

## Structure

```
tests/sdk-e2e-py/
├── pyproject.toml       # project metadata + pytest config + workspace member
├── package.json         # turbo integration — `e2e` script shells to `uv run pytest`
├── conftest.py          # session fixtures: client, async_client, run_id
├── _helpers.py          # SKIP_IF_NO_CREDS, wait_for_status, async_wait_for_status
├── test_system.py       # client.system.health()
├── test_sandboxes.py    # create, get, list, patch, pause, resume, delete
├── test_exec.py         # command (sync + failing), command_stream
└── test_async.py        # async smoke: AsyncSuperserve create → exec → delete
```

Each sync test file owns its own sandbox via a `@pytest.fixture(scope="module")` — created once per file, reused across tests, deleted in the fixture teardown so cleanup runs even on failure. Sandbox names include a unique `run_id` so orphans from crashed runs are identifiable for manual cleanup.

## Run

Defaults to **staging** (`https://api-staging.superserve.ai`):

```bash
cd tests/sdk-e2e-py
SUPERSERVE_API_KEY=ss_... uv run pytest
```

From the repo root (via turbo):

```bash
SUPERSERVE_API_KEY=ss_... bun run test:e2e
```

This runs both the TypeScript (`tests/sdk-e2e-ts`) and Python (`tests/sdk-e2e-py`) e2e suites in sequence.

### Target a different environment

```bash
# production
SUPERSERVE_API_KEY=ss_live_... \
SUPERSERVE_BASE_URL=https://api.superserve.ai \
  uv run pytest

# local dev server
SUPERSERVE_API_KEY=ss_dev_... \
SUPERSERVE_BASE_URL=http://localhost:8080 \
  uv run pytest
```

### Without credentials

```bash
uv run pytest
```

Every test file has `pytestmark = SKIP_IF_NO_CREDS` at the top, which uses `pytest.mark.skipif` to skip the whole module at collection time when `SUPERSERVE_API_KEY` isn't set. With no key, every test is reported as skipped and pytest exits 0.

## Coverage

| Resource    | Method               | Test file              |
|-------------|----------------------|------------------------|
| `system`    | `health()`           | `test_system.py`       |
| `sandboxes` | `create_sandbox()`   | both fixtures          |
| `sandboxes` | `get_sandbox()`      | `test_sandboxes.py`    |
| `sandboxes` | `list_sandboxes()`   | `test_sandboxes.py`    |
| `sandboxes` | `patch_sandbox()`    | `test_sandboxes.py`    |
| `sandboxes` | `pause_sandbox()`    | `test_sandboxes.py`    |
| `sandboxes` | `resume_sandbox()`   | `test_sandboxes.py`    |
| `sandboxes` | `delete_sandbox()`   | both fixture teardowns |
| `exec`      | `command()` (pass)   | `test_exec.py`         |
| `exec`      | `command()` (fail)   | `test_exec.py`         |
| `exec`      | `command_stream()`   | `test_exec.py`         |
| `AsyncSuperserve` | smoke flow     | `test_async.py`        |

The Python SDK does not currently expose a `files` resource — the backend's `openapi.yaml` doesn't include file upload/download endpoints. When they land, add a `test_files.py` following the same pattern.

## Conventions

- **Pytest**, not unittest. Industry standard for Python SDK tests.
- **One file per resource.** Same as the TS suite, same as Stripe / OpenAI / Anthropic.
- **Shared sandbox per suite via `@pytest.fixture(scope="module")`** — mirrors `beforeAll`/`afterAll` in the TS suite. Tests inside a file reuse the same sandbox, minimizing API calls.
- **Polling over sleeping.** `wait_for_status()` polls `get_sandbox` until the expected status is observed or the timeout elapses with a clear error message.
- **Cleanup is non-fatal.** If fixture teardown fails, the error is printed but doesn't mask real test failures. Orphans are identifiable by their `sdk-e2e-py-*-{run_id}` prefix.
- **`pytestmark = SKIP_IF_NO_CREDS`** at the top of every test file — pytest's idiomatic pattern for gating an entire module on an environment condition.
- **Async via `pytest-asyncio` strict mode.** Every async test uses `@pytest.mark.asyncio` explicitly. Matches the repo-wide `asyncio_mode = "strict"` setting.
- **Generous timeouts.** 60s per `wait_for_status` by default, 90s for pause/resume which can legitimately take that long.

## Why this is separate from the CI test pipeline

Same reasoning as the TS e2e:

1. **Credentials.** Running on every PR would require a CI secret and generate load + cost on staging.
2. **Speed.** A full run is ~30–90 seconds depending on sandbox boot times.
3. **Flakiness domain.** E2e failures can reflect backend issues, network issues, or quota issues — not SDK bugs. Keeping them out of the unit test pipeline preserves signal.

Recommended invocation patterns:

- **Manually** before a release, to verify the Python SDK works against production
- **Scheduled CI** (e.g., a GitHub Actions cron job) running against staging nightly
- **On-demand CI** via `workflow_dispatch` for debugging
