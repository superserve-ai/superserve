# Templates — SDK & Docs Design

## Context

Superserve's backend supports **templates** — reusable base images with optional build steps that sandboxes boot from. The OpenAPI spec defines full CRUD: list, create (kicks off first build), get, delete, rebuild, list builds, get build, cancel build, stream build logs via SSE.

Today:
- **Console** (`apps/console/`) fully consumes the templates API — list page, detail page, create dialog, build history, log viewer.
- **TS SDK** (`packages/sdk/`) and **Python SDK** (`packages/python-sdk/`) — recently rewritten from Fern-generated to hand-crafted (`spec/2026-04-16-sdk-from-scratch-design.md`, commit `5e7b418`) — have **zero** template coverage.
- **Docs** (`docs/`, Mintlify) cover sandbox / commands / filesystem / errors but have no template pages.
- **CLI** is deprecated (out of scope).

This spec designs the additions to bring templates to the two SDKs and the docs site, at the same DX bar as the existing sandbox surface (E2B/Daytona-grade).

## Goals

1. **Best-in-class DX** — `Template` class parallel to `Sandbox`, single import, sub-module pattern, callbacks for streaming consistent with `commands.run`.
2. **Consistent with existing SDK conventions** — camelCase TS / snake_case Python, Pydantic models, private constructors, static factories, structured error hierarchy, per-call `signal` / `api_key` overrides.
3. **Type-safe** — exhaustive types for `TemplateInfo`, `TemplateBuildInfo`, `BuildLogEvent`, and the `BuildStep` discriminated union.
4. **Zero surprise migration** — `Sandbox.create` gains `fromTemplate` / `fromSnapshot` options; everything else about sandboxes is unchanged.
5. **Docs parity** — templates get the same quality of guide + per-class reference coverage as sandboxes.

## Non-Goals

- CLI template commands (CLI is deprecated)
- Declarative config file (`superserve.yaml`) for templates
- React hooks for templates (`@superserve/sdk/react`)
- YAML loader helper (`Template.fromFile`)
- Console migration from proxy-fetch to SDK
- `setTimeout` / `extendTimeout` / context managers / SSE reconnect policy — separate gaps flagged during audit; tackled independently

## Scope

| Surface | Inclusion |
|---|---|
| TypeScript SDK (`packages/sdk/`) | In — new `Template` class, `Sandbox.create` extension, types, new `BuildError` |
| Python SDK (`packages/python-sdk/`) | In — new `Template` + `AsyncTemplate` classes, same surface |
| Docs (`docs/`, Mintlify) | In — 4 new guide pages + 1 SDK reference page + minor updates |
| CLI | Out — deprecated |
| Console migration | Out — separate follow-up |

---

## 1. TypeScript SDK

New file: `packages/sdk/src/Template.ts`. Exported from `index.ts`.

### 1.1 User-facing snippet

```ts
import { Template, Sandbox } from "@superserve/sdk"

const template = await Template.create({
  alias: "my-python-env",
  vcpu: 2,
  memoryMib: 2048,
  diskMib: 4096,
  from: "python:3.11",
  steps: [
    { run: "pip install numpy pandas" },
    { env: { key: "DEBUG", value: "1" } },
    { workdir: "/app" },
    { user: { name: "appuser", sudo: true } },
  ],
  startCmd: "python server.py",
  readyCmd: "curl -f http://localhost:8080/health",
})

await template.waitUntilReady({
  onLog: (event) => {
    if (event.stream === "system") return
    process.stdout.write(event.text)
  },
})

const sandbox = await Sandbox.create({ name: "run-1", fromTemplate: template })
```

### 1.2 Class surface

**Static factories** (mirror `Sandbox`):

| Method | Returns | Notes |
|---|---|---|
| `Template.create(options)` | `Template` | Returns once `POST /templates` returns 202 — i.e. first build is *queued*, not finished. Call `waitUntilReady()` to block until terminal. |
| `Template.connect(aliasOrId, opts?)` | `Template` | `GET /templates/{id}` (backend resolves alias or UUID). |
| `Template.list(opts?)` | `TemplateInfo[]` | Supports `aliasPrefix` filter. |
| `Template.deleteById(aliasOrId, opts?)` | `void` | Idempotent on 404. Uses HTTP verb `delete` (matches backend `DELETE /templates/{id}` and the "soft-delete" semantics — templates are config artifacts, not processes). |

**Instance methods:**

| Method | Returns | Notes |
|---|---|---|
| `getInfo()` | `TemplateInfo` | Refresh from `GET /templates/{id}`. |
| `waitUntilReady(opts?)` | `TemplateInfo` | Subscribes to SSE log stream of the current build if `onLog` is provided; resolves on terminal status; throws `BuildError` on `failed`, `ConflictError` on `cancelled`. Respects `AbortSignal`. |
| `streamBuildLogs(opts)` | `void` (promise resolves when stream closes) | Pure log streaming, no wait. Opts: `{ onEvent, buildId?, signal? }`. `buildId` defaults to `latestBuildId`. |
| `rebuild()` | `TemplateBuildInfo` | `POST /templates/{id}/builds`. Idempotent on `build_spec_hash`. |
| `listBuilds({ limit? })` | `TemplateBuildInfo[]` | |
| `getBuild(buildId)` | `TemplateBuildInfo` | |
| `cancelBuild(buildId)` | `void` | Idempotent on 404 or already-terminal. |
| `delete()` | `void` | Idempotent on 404. Throws `ConflictError` if sandboxes still reference the template. |

**Instance properties (snapshot at construction):**

`id`, `alias`, `teamId`, `status`, `vcpu`, `memoryMib`, `diskMib`, `sizeBytes?`, `errorMessage?`, `createdAt`, `builtAt?`, `latestBuildId?`.

As with `Sandbox`, these don't mutate after construction — `getInfo()` is the way to refresh.

### 1.3 `Sandbox.create` extension

Add to `SandboxCreateOptions` in `types.ts`:

```ts
interface SandboxCreateOptions extends ConnectionOptions {
  name: string
  fromTemplate?: string | Template   // alias, UUID, or Template instance
  fromSnapshot?: string              // snapshot UUID
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  network?: NetworkConfig
}
```

`Sandbox.create` maps `fromTemplate` → API body `from_template`. If the caller passes a `Template` instance, SDK extracts `.alias` (falling back to `.id` if alias is absent).

### 1.4 New types in `types.ts`

```ts
export type TemplateStatus = "pending" | "building" | "ready" | "failed"
export type TemplateBuildStatus =
  | "pending" | "building" | "snapshotting" | "ready" | "failed" | "cancelled"
export type BuildLogStream = "stdout" | "stderr" | "system"

export interface TemplateInfo {
  id: string
  alias: string
  teamId: string
  status: TemplateStatus
  vcpu: number
  memoryMib: number
  diskMib: number
  sizeBytes?: number
  errorMessage?: string
  createdAt: Date
  builtAt?: Date
  latestBuildId?: string
}

export interface TemplateBuildInfo {
  id: string
  templateId: string
  status: TemplateBuildStatus
  buildSpecHash: string
  errorMessage?: string
  startedAt?: Date
  finalizedAt?: Date
  createdAt: Date
}

export interface BuildLogEvent {
  timestamp: Date
  stream: BuildLogStream
  text: string
  finished?: boolean
  status?: "ready" | "failed" | "cancelled"
}

// Discriminated union — exactly one key present
export type BuildStep =
  | { run: string }
  | { env: { key: string; value: string } }
  | { workdir: string }
  | { user: { name: string; sudo?: boolean } }

export interface TemplateCreateOptions extends ConnectionOptions {
  alias: string
  vcpu?: number
  memoryMib?: number
  diskMib?: number
  from: string          // BuildSpec flattened — `from`/`steps`/`startCmd`/`readyCmd` hoisted to top level
  steps?: BuildStep[]
  startCmd?: string
  readyCmd?: string
}

export interface TemplateListOptions extends ConnectionOptions { aliasPrefix?: string }
export interface TemplateBuildsListOptions extends ConnectionOptions { limit?: number }
export interface BuildLogsOptions {
  onEvent: (ev: BuildLogEvent) => void
  buildId?: string
  signal?: AbortSignal
}
export interface WaitUntilReadyOptions {
  onLog?: (ev: BuildLogEvent) => void
  signal?: AbortSignal
  pollIntervalMs?: number     // fallback polling if SSE errors; default 2000
}

/** @internal */ export interface ApiTemplateResponse { /* snake_case */ }
/** @internal */ export interface ApiTemplateBuildResponse { /* snake_case */ }
/** @internal */ export interface ApiBuildLogEvent { /* snake_case */ }
/** @internal */ export interface ApiCreateTemplateResponse { /* includes build_id */ }
```

Internal helpers: `toTemplateInfo(raw)`, `toTemplateBuildInfo(raw)`, `toBuildLogEvent(raw)`, `toBuildStepsApi(steps)` (outbound camelCase→snake_case for user/env nested).

### 1.5 New error class

Add to `errors.ts`:

```ts
export class BuildError extends SandboxError {
  readonly code: string        // image_pull_failed | step_failed | boot_failed |
                               // snapshot_failed | start_cmd_failed | ready_cmd_failed | build_failed
  readonly buildId: string
  readonly templateId: string

  constructor(message: string, opts: {
    code: string
    buildId: string
    templateId: string
    statusCode?: number
  }) { ... }
}
```

Thrown only from `waitUntilReady()` on terminal `failed`. `cancelled` → `ConflictError`. 429 `too_many_builds` → existing `SandboxError` (the `error.code` on the envelope is surfaced via the existing `.code` field).

### 1.6 Index exports — `packages/sdk/src/index.ts`

Add:

```ts
export { Template } from "./Template.js"
export { BuildError } from "./errors.js"
export type {
  TemplateInfo,
  TemplateBuildInfo,
  TemplateStatus,
  TemplateBuildStatus,
  BuildLogEvent,
  BuildLogStream,
  BuildStep,
  TemplateCreateOptions,
  TemplateListOptions,
  TemplateBuildsListOptions,
  BuildLogsOptions,
  WaitUntilReadyOptions,
} from "./types.js"
```

### 1.7 SSE streaming (reuses existing `http.ts` primitives)

`http.ts` already exports `streamSSE()` with idle-timeout reset and network-drop detection. `Template.streamBuildLogs` and `Template.waitUntilReady` (when `onLog` is provided) reuse `streamSSE` directly — no new infrastructure.

`waitUntilReady` control flow:
1. Open SSE stream on `GET /templates/{id}/builds/{buildId}/logs` (if `onLog`).
2. For each event, call `onLog(toBuildLogEvent(ev))`.
3. When an event arrives with `finished: true`, resolve with `getInfo()`.
4. If `status === "failed"`, throw `BuildError` using `errorMessage`-prefix parse.
5. If the SSE stream errors (network drop), fall back to polling `getInfo()` every `pollIntervalMs` until terminal.
6. `signal` aborts both the stream and any pending poll.

### 1.8 Tests — `packages/sdk/tests/`

New files: `template.test.ts`, `build-logs.test.ts`. Cover:
- `Template.create` builds correct snake_case body, flattens `BuildSpec` correctly, maps steps including nested `env`/`user`.
- `Template.create` throws on missing `build_id` in response.
- `Sandbox.create({ fromTemplate: "..." })` maps to `from_template` body.
- `Sandbox.create({ fromTemplate: templateInstance })` extracts alias/id.
- `toTemplateInfo` / `toTemplateBuildInfo` round-trip correctly; missing optional fields absent.
- `BuildError.code` parsed from `error_message` prefix.
- `waitUntilReady` resolves on `ready`, throws `BuildError` on `failed`, throws `ConflictError` on `cancelled`.
- `waitUntilReady` falls back to polling when SSE errors.
- `streamBuildLogs` forwards events via `onEvent`.

E2E tests under `tests/sdk-e2e-ts/` — a new `templates.test.ts` that creates a real template from `python:3.11`, streams logs, waits, creates a sandbox from it, deletes. Gated by `SUPERSERVE_API_KEY` like existing e2e tests.

---

## 2. Python SDK

Parity with existing sync/async split. Two new files:
- `packages/python-sdk/src/superserve/template.py` (sync `Template`)
- `packages/python-sdk/src/superserve/async_template.py` (async `AsyncTemplate`)

### 2.1 User-facing snippet (sync)

```python
from superserve import Template, Sandbox
from superserve.types import RunStep, EnvStep, EnvStepValue, WorkdirStep, UserStep, UserStepValue

template = Template.create(
    alias="my-python-env",
    vcpu=2,
    memory_mib=2048,
    disk_mib=4096,
    from_="python:3.11",
    steps=[
        RunStep(run="pip install numpy pandas"),
        EnvStep(env=EnvStepValue(key="DEBUG", value="1")),
        WorkdirStep(workdir="/app"),
        UserStep(user=UserStepValue(name="appuser", sudo=True)),
    ],
    start_cmd="python server.py",
    ready_cmd="curl -f http://localhost:8080/health",
)

template.wait_until_ready(
    on_log=lambda ev: print(ev.text, end="") if ev.stream != "system" else None,
)

sandbox = Sandbox.create(name="run-1", from_template=template)
```

### 2.2 Naming specifics

- `from_` (trailing underscore) — Python reserved word.
- `on_log` / `on_event` callbacks are `Callable[[BuildLogEvent], None]`. Same convention as `commands.run(on_stdout=...)`.
- `async_template.py` callbacks may be sync or `awaitable` — run through a small adapter in `_http.async_stream_sse`.

### 2.3 Method surface

Sync `Template` and async `AsyncTemplate` each expose:

**Static** (classmethod): `create`, `connect`, `list`, `delete_by_id`.

**Instance:** `get_info`, `wait_until_ready`, `stream_build_logs`, `rebuild`, `list_builds`, `get_build`, `cancel_build`, `delete`.

**Properties:** `id`, `alias`, `team_id`, `status`, `vcpu`, `memory_mib`, `disk_mib`, `size_bytes`, `error_message`, `created_at`, `built_at`, `latest_build_id`.

### 2.4 `Sandbox.create` / `AsyncSandbox.create` extension

Add to both `sandbox.py` and `async_sandbox.py`:

```python
@classmethod
def create(
    cls,
    *,
    name: str,
    from_template: "str | Template | None" = None,
    from_snapshot: str | None = None,
    timeout_seconds: int | None = None,
    metadata: dict[str, str] | None = None,
    env_vars: dict[str, str] | None = None,
    network: NetworkConfig | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> Sandbox: ...
```

When `from_template` is a `Template` / `AsyncTemplate` instance, extract `.alias` (fallback `.id`).

### 2.5 New types — `types.py`

All Pydantic `BaseModel` / `str, Enum`:

```python
class TemplateStatus(str, Enum):
    PENDING = "pending"; BUILDING = "building"; READY = "ready"; FAILED = "failed"

class TemplateBuildStatus(str, Enum):
    PENDING = "pending"; BUILDING = "building"; SNAPSHOTTING = "snapshotting"
    READY = "ready"; FAILED = "failed"; CANCELLED = "cancelled"

class BuildLogStream(str, Enum):
    STDOUT = "stdout"; STDERR = "stderr"; SYSTEM = "system"

class TemplateInfo(BaseModel): ...
class TemplateBuildInfo(BaseModel): ...
class BuildLogEvent(BaseModel): ...

# Discriminated union for BuildStep
class RunStep(BaseModel): run: str
class EnvStepValue(BaseModel): key: str; value: str
class EnvStep(BaseModel): env: EnvStepValue
class WorkdirStep(BaseModel): workdir: str
class UserStepValue(BaseModel): name: str; sudo: bool = False
class UserStep(BaseModel): user: UserStepValue

BuildStep = RunStep | EnvStep | WorkdirStep | UserStep   # type alias; no discriminator needed — mutually exclusive fields
```

Helpers `to_template_info`, `to_template_build_info`, `to_build_log_event`, and `build_steps_to_api` (outbound Pydantic → dict with snake_case nested `env`/`user`).

### 2.6 New error — `errors.py`

```python
class BuildError(SandboxError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        build_id: str,
        template_id: str,
        status_code: int | None = None,
    ) -> None: ...
```

### 2.7 Public exports — `__init__.py`

Add: `Template`, `AsyncTemplate`, `BuildError`, plus all new types + step classes + enums.

### 2.8 Tests — `packages/python-sdk/tests/`

Parallel structure: `test_template.py`, `test_async_template.py`, `test_build_logs.py`. Same coverage as TS tests. E2E under `tests/sdk-e2e-py/` — `test_templates.py`.

---

## 3. Docs (Mintlify)

### 3.1 New folder — `docs/templates/`

Four guide pages:

| Page | Purpose |
|---|---|
| `templates/overview.mdx` | Concept + system/team distinction. Sections: What is a template • System templates (list: `superserve/base`, `superserve/python-3.11`, `superserve/node-22`) • Team templates • Aliases vs UUIDs. |
| `templates/create.mdx` | Primary DX entry — build your first template end-to-end. Sections: Create a template • Stream build logs • Wait for ready • Create a sandbox from it. |
| `templates/lifecycle.mdx` | Rebuild, cancel, delete. Sections: Rebuild (idempotent on spec hash) • Cancel an in-flight build • List builds • Delete (409 semantics: destroy dependent sandboxes first). |
| `templates/build-spec.mdx` | BuildSpec reference. Sections: `from` (OCI image, linux/amd64, no alpine/distroless) • Steps (`run`, `env`, `workdir`, `user`) • `start_cmd` / `ready_cmd` • Resource limits (vcpu 1-4, memory 256-4096 MiB, disk 1024-8192 MiB) • Build error codes. |

Every page uses `<CodeGroup>` tabs with TS + Python examples side-by-side.

### 3.2 New SDK reference — `docs/sdk-reference/template.mdx`

Per-class reference, same shape as `sdk-reference/sandbox.mdx`:
- Class overview + import
- Static methods block
- Instance methods block
- Types sidebar (`TemplateInfo`, `TemplateBuildInfo`, `BuildLogEvent`, `BuildStep`, step variants)
- `BuildError` entry (cross-linked from `errors.mdx`)

### 3.3 Updates to existing pages

- `docs/sandbox/create.mdx` — new subsection "Create from a template" showing `fromTemplate` / `from_template`. Example uses `superserve/python-3.11`.
- `docs/sdk-reference/sandbox.mdx` — include `fromTemplate` / `fromSnapshot` in the options table.
- `docs/errors.mdx` — add `BuildError` entry with fields + `code` enumeration + when thrown.
- `docs/quickstart.mdx` — no change (stays on base template for first-time flow).

### 3.4 Nav updates — `docs/docs.json`

Add a new **"Templates"** top-level group between **"Sandbox"** and **"Commands"**:

```
Get Started → Sandbox → Templates → Commands → Filesystem → Errors → SDK Reference → API Reference
```

Add `sdk-reference/template` to the SDK Reference group. API Reference (OpenAPI tab) picks up `/templates` endpoints automatically when the upstream OpenAPI regen lands.

---

## 4. Design decisions & rationale

| Decision | Rationale |
|---|---|
| `Template` class parallel to `Sandbox` | Consistency with existing ergonomic pattern (`spec/2026-04-16-sdk-from-scratch-design.md` explicitly called out templates as a future extension). E2B/Daytona convention. |
| Callback-based streaming (`onLog`, `onEvent`) — not async iterators | Matches existing `commands.run({ onStdout })` pattern. Mixing patterns would create cognitive overhead. |
| `BuildSpec` flattened (`from`, `steps`, `startCmd`, `readyCmd` at top level of `TemplateCreateOptions`) — not nested `buildSpec: {...}` | Fewer levels of nesting, closer to E2B (`Dockerfile`) and Daytona (flat config). API layer still produces nested `build_spec` for transport. |
| `Template.deleteById` / `template.delete` — not `killById` / `kill` | Backend verb is `DELETE` (soft-delete). Templates are config artifacts, not live processes; "kill" is semantically wrong. Diverges from `Sandbox.killById` intentionally. |
| `fromTemplate` accepts `string \| Template` | Common pattern — lets users either pass a literal alias or chain off a created template. Same pattern as Daytona. |
| `BuildStep` discriminated union instead of `{ run?, env?, workdir?, user? }` | Type safety: the user can't accidentally set two keys at once. API spec enforces exactly-one-field anyway. |
| `BuildError` only, not `CancelledError` / `TooManyBuildsError` | Minimal new error surface. `ConflictError` covers cancellation semantics; existing `.code` on envelope covers 429 sub-cases. |
| Polling fallback in `waitUntilReady` | SSE can drop on long builds. Falling back to `pollIntervalMs` polling gives reliability without requiring the caller to handle errors. |
| No React hooks, no YAML loader, no CLI | Deferred — out of scope (see Non-Goals). |

## 5. Out-of-scope follow-ups identified during audit

These are real gaps worth tracking but not part of this project:

1. **`setTimeout` / `extendTimeout`** on Sandbox — no way to extend lifetime post-creation.
2. **SSE auto-reconnect** — streams drop on network errors; caller has to restart.
3. **`.status` snapshot footgun** — docs don't clearly explain that instance properties are construction-time snapshots; `getInfo()` is the refresh path.
4. **Python context managers** — no `with Sandbox.create(...)` support.
5. **Console migration to SDK** — console still uses proxy-fetch; SDK is an internal consumer gap.

## 6. Acceptance criteria

1. `Template.create` / `Template.connect` / `Template.list` / `Template.deleteById` work against staging API end-to-end (TS + Python, sync + async).
2. `Sandbox.create({ fromTemplate: "superserve/python-3.11" })` successfully boots a sandbox from a system template.
3. `Sandbox.create({ fromTemplate: templateInstance })` works after `await template.waitUntilReady()`.
4. `waitUntilReady({ onLog })` streams events to the callback; resolves on `ready`; throws `BuildError` on `failed` with parsed `.code`.
5. `rebuild()` is idempotent on spec hash (second call within an in-flight build returns the same build id).
6. Docs pages render without Mintlify errors; all `<CodeGroup>` examples compile.
7. Unit tests + e2e tests pass in CI.
8. `bun run typecheck` clean; `uv run mypy packages/python-sdk/src/superserve/` clean.
