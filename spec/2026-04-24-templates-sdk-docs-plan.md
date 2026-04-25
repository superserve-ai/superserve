# Templates SDK & Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User prefs (from brief):** The user prefers **not to commit automatically** — commit steps are included as documentation for the end state, but the human in the loop should review diffs and run them. Use `bun` (not npm), follow `CLAUDE.md` conventions (single-line commit messages, no AI attribution, `spec/` for planning docs).

**Goal:** Add template support to the hand-crafted TypeScript SDK and Python SDK, with Mintlify docs coverage, matching the existing `Sandbox` class ergonomic patterns (callback-based streaming, structured errors, sync/async Python parity).

**Architecture:** A new `Template` class parallels the existing `Sandbox` class in both SDKs. Static factories (`create`, `connect`, `list`, `deleteById`), instance methods (`getInfo`, `rebuild`, `delete`, `waitUntilReady`, `streamBuildLogs`, `listBuilds`, `getBuild`, `cancelBuild`). `Sandbox.create` is extended with `fromTemplate` / `fromSnapshot` options. Build log streaming reuses the existing SSE primitive (extended with method-override for GET endpoints).

**Tech Stack:** TypeScript 5 + Vitest, Python 3.9+ + pytest + httpx + Pydantic v2 + respx for HTTP mocking, Mintlify for docs.

**Spec reference:** `spec/2026-04-24-templates-sdk-docs-design.md`

---

## File structure

### TypeScript SDK — `packages/sdk/src/`

| File | Action | Responsibility |
|---|---|---|
| `types.ts` | Modify | Add template types (`TemplateInfo`, `TemplateBuildInfo`, `BuildLogEvent`, `BuildStep` union, enums, API-shape interfaces, converters). Extend `SandboxCreateOptions` with `fromTemplate` / `fromSnapshot`. |
| `errors.ts` | Modify | Add `BuildError` class. |
| `http.ts` | Modify | Extend `streamSSE` to accept optional `method` + no-body calls (GET for build logs). |
| `Template.ts` | Create | `Template` class: static factories + instance methods + SSE wiring. |
| `Sandbox.ts` | Modify | Accept `fromTemplate` / `fromSnapshot` in `create`. Extract alias from `Template` instance when passed. |
| `index.ts` | Modify | Export `Template`, `BuildError`, new types. |

### TypeScript SDK — `packages/sdk/tests/`

| File | Action | Responsibility |
|---|---|---|
| `template.test.ts` | Create | Unit tests for `Template` class (statics + instance CRUD + rebuild + builds). |
| `build-logs.test.ts` | Create | Unit tests for `streamBuildLogs` / `waitUntilReady` (SSE handling + `BuildError` mapping + polling fallback). |
| `sandbox.test.ts` | Modify | Add cases for `fromTemplate` / `fromSnapshot` on `Sandbox.create`. |
| `http.test.ts` | Modify | Add case for `streamSSE` with GET. |

### TypeScript SDK — `tests/sdk-e2e-ts/src/tests/`

| File | Action | Responsibility |
|---|---|---|
| `templates.test.ts` | Create | End-to-end: create → wait → launch sandbox from template → delete. |

### Python SDK — `packages/python-sdk/src/superserve/`

| File | Action | Responsibility |
|---|---|---|
| `types.py` | Modify | Add template enums + Pydantic models + step discriminated union + converters. |
| `errors.py` | Modify | Add `BuildError`. |
| `_http.py` | Modify | Extend `stream_sse` / `async_stream_sse` with method override. |
| `template.py` | Create | Sync `Template` class. |
| `async_template.py` | Create | Async `AsyncTemplate` class. |
| `sandbox.py` | Modify | Accept `from_template` / `from_snapshot` in `create`. |
| `async_sandbox.py` | Modify | Same. |
| `__init__.py` | Modify | Export `Template`, `AsyncTemplate`, `BuildError`, new types. |

### Python SDK — `packages/python-sdk/tests/`

| File | Action | Responsibility |
|---|---|---|
| `test_template.py` | Create | Unit tests for sync `Template`. |
| `test_async_template.py` | Create | Unit tests for `AsyncTemplate`. |
| `test_build_logs.py` | Create | Unit tests for `stream_build_logs` / `wait_until_ready`. |
| `test_sandbox.py` | Modify | Add cases for `from_template` / `from_snapshot`. |

### Python SDK — `tests/sdk-e2e-py/`

| File | Action | Responsibility |
|---|---|---|
| `test_templates.py` | Create | End-to-end parity with TS. |

### Docs — `docs/`

| File | Action | Responsibility |
|---|---|---|
| `templates/overview.mdx` | Create | Concept + system vs team templates. |
| `templates/create.mdx` | Create | Primary guide: build your first template. |
| `templates/lifecycle.mdx` | Create | Rebuild / cancel / delete. |
| `templates/build-spec.mdx` | Create | BuildSpec reference + error codes. |
| `sdk-reference/template.mdx` | Create | Per-class SDK reference. |
| `sandbox/create.mdx` | Modify | Add "Create from a template" subsection. |
| `sdk-reference/sandbox.mdx` | Modify | Document `fromTemplate` / `fromSnapshot`. |
| `errors.mdx` | Modify | Document `BuildError`. |
| `docs.json` | Modify | Add "Templates" nav group; add `sdk-reference/template`. |

---

## Phase 1 — TypeScript SDK foundation (types + errors + http)

### Task 1: Add template types to `types.ts`

**Files:**
- Modify: `packages/sdk/src/types.ts`
- Test: `packages/sdk/tests/types.test.ts`

- [ ] **Step 1: Write failing tests for the converters**

Append to `packages/sdk/tests/types.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  toTemplateInfo,
  toTemplateBuildInfo,
  toBuildLogEvent,
  buildStepsToApi,
} from "../src/types.js"

describe("toTemplateInfo", () => {
  it("converts snake_case API to camelCase", () => {
    const info = toTemplateInfo({
      id: "t-1",
      team_id: "team-1",
      alias: "my-env",
      status: "ready",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 4096,
      size_bytes: 12345,
      created_at: "2026-01-01T00:00:00Z",
      built_at: "2026-01-01T00:01:00Z",
    })
    expect(info.id).toBe("t-1")
    expect(info.alias).toBe("my-env")
    expect(info.status).toBe("ready")
    expect(info.vcpu).toBe(2)
    expect(info.memoryMib).toBe(2048)
    expect(info.diskMib).toBe(4096)
    expect(info.sizeBytes).toBe(12345)
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.builtAt).toBeInstanceOf(Date)
  })

  it("handles optional fields absent", () => {
    const info = toTemplateInfo({
      id: "t-1",
      team_id: "team-1",
      alias: "my-env",
      status: "building",
      vcpu: 1,
      memory_mib: 1024,
      disk_mib: 4096,
      created_at: "2026-01-01T00:00:00Z",
    })
    expect(info.sizeBytes).toBeUndefined()
    expect(info.builtAt).toBeUndefined()
    expect(info.errorMessage).toBeUndefined()
  })

  it("throws on missing id", () => {
    expect(() => toTemplateInfo({ alias: "x", status: "ready" } as any))
      .toThrow(/missing template id/)
  })
})

describe("toTemplateBuildInfo", () => {
  it("converts snake_case API to camelCase", () => {
    const info = toTemplateBuildInfo({
      id: "b-1",
      template_id: "t-1",
      status: "ready",
      build_spec_hash: "hash123",
      started_at: "2026-01-01T00:00:00Z",
      finalized_at: "2026-01-01T00:01:00Z",
      created_at: "2026-01-01T00:00:00Z",
    })
    expect(info.id).toBe("b-1")
    expect(info.templateId).toBe("t-1")
    expect(info.status).toBe("ready")
    expect(info.buildSpecHash).toBe("hash123")
    expect(info.startedAt).toBeInstanceOf(Date)
  })
})

describe("toBuildLogEvent", () => {
  it("converts snake_case fields", () => {
    const ev = toBuildLogEvent({
      timestamp: "2026-01-01T00:00:00Z",
      stream: "stdout",
      text: "hello",
      finished: true,
      status: "ready",
    })
    expect(ev.stream).toBe("stdout")
    expect(ev.text).toBe("hello")
    expect(ev.finished).toBe(true)
    expect(ev.status).toBe("ready")
    expect(ev.timestamp).toBeInstanceOf(Date)
  })
})

describe("buildStepsToApi", () => {
  it("passes run step through unchanged", () => {
    const steps = buildStepsToApi([{ run: "echo hello" }])
    expect(steps).toEqual([{ run: "echo hello" }])
  })

  it("serialises env step with nested key/value", () => {
    const steps = buildStepsToApi([{ env: { key: "DEBUG", value: "1" } }])
    expect(steps).toEqual([{ env: { key: "DEBUG", value: "1" } }])
  })

  it("serialises user step with default sudo=false", () => {
    const steps = buildStepsToApi([{ user: { name: "appuser" } }])
    expect(steps).toEqual([{ user: { name: "appuser" } }])
  })

  it("preserves sudo true when set", () => {
    const steps = buildStepsToApi([{ user: { name: "appuser", sudo: true } }])
    expect(steps).toEqual([{ user: { name: "appuser", sudo: true } }])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bunx turbo run test --filter=@superserve/sdk -- types.test.ts
```
Expected: FAIL — `toTemplateInfo`, `toTemplateBuildInfo`, `toBuildLogEvent`, `buildStepsToApi` not exported.

- [ ] **Step 3: Add the types and converters**

Append to `packages/sdk/src/types.ts` (after the existing `Commands` section):

```ts
// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export type TemplateStatus = "pending" | "building" | "ready" | "failed"

export type TemplateBuildStatus =
  | "pending"
  | "building"
  | "snapshotting"
  | "ready"
  | "failed"
  | "cancelled"

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

// Discriminated union: exactly one of the four fields is present.
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
  from: string
  steps?: BuildStep[]
  startCmd?: string
  readyCmd?: string
}

export interface TemplateListOptions extends ConnectionOptions {
  aliasPrefix?: string
}

export interface TemplateBuildsListOptions extends ConnectionOptions {
  limit?: number
}

export interface BuildLogsOptions {
  onEvent: (ev: BuildLogEvent) => void
  buildId?: string
  signal?: AbortSignal
}

export interface WaitUntilReadyOptions {
  onLog?: (ev: BuildLogEvent) => void
  signal?: AbortSignal
  pollIntervalMs?: number
}

// ---------------------------------------------------------------------------
// Internal: API shapes
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiTemplateResponse {
  id?: string
  team_id?: string
  alias?: string
  status?: string
  vcpu?: number
  memory_mib?: number
  disk_mib?: number
  size_bytes?: number
  error_message?: string
  created_at?: string
  built_at?: string
  latest_build_id?: string
}

/** @internal */
export interface ApiTemplateBuildResponse {
  id?: string
  template_id?: string
  status?: string
  build_spec_hash?: string
  error_message?: string
  started_at?: string
  finalized_at?: string
  created_at?: string
}

/** @internal */
export interface ApiCreateTemplateResponse extends ApiTemplateResponse {
  build_id?: string
}

/** @internal */
export interface ApiBuildLogEvent {
  timestamp?: string
  stream?: string
  text?: string
  finished?: boolean
  status?: string
}

// ---------------------------------------------------------------------------
// Template converters
// ---------------------------------------------------------------------------

export function toTemplateInfo(
  raw: ApiTemplateResponse,
  latestBuildId?: string,
): TemplateInfo {
  if (!raw.id) throw new SandboxError("Invalid API response: missing template id")
  if (!raw.alias) throw new SandboxError("Invalid API response: missing template alias")
  if (!raw.status) throw new SandboxError("Invalid API response: missing template status")
  if (!raw.team_id) throw new SandboxError("Invalid API response: missing team_id")
  if (!raw.created_at) throw new SandboxError("Invalid API response: missing created_at")

  return {
    id: raw.id,
    alias: raw.alias,
    teamId: raw.team_id,
    status: raw.status as TemplateStatus,
    vcpu: raw.vcpu ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    diskMib: raw.disk_mib ?? 0,
    sizeBytes: raw.size_bytes,
    errorMessage: raw.error_message,
    createdAt: new Date(raw.created_at),
    builtAt: raw.built_at ? new Date(raw.built_at) : undefined,
    latestBuildId: latestBuildId ?? raw.latest_build_id,
  }
}

export function toTemplateBuildInfo(
  raw: ApiTemplateBuildResponse,
): TemplateBuildInfo {
  if (!raw.id) throw new SandboxError("Invalid API response: missing build id")
  if (!raw.template_id) throw new SandboxError("Invalid API response: missing template_id")
  if (!raw.status) throw new SandboxError("Invalid API response: missing build status")
  if (!raw.build_spec_hash) throw new SandboxError("Invalid API response: missing build_spec_hash")
  if (!raw.created_at) throw new SandboxError("Invalid API response: missing created_at")

  return {
    id: raw.id,
    templateId: raw.template_id,
    status: raw.status as TemplateBuildStatus,
    buildSpecHash: raw.build_spec_hash,
    errorMessage: raw.error_message,
    startedAt: raw.started_at ? new Date(raw.started_at) : undefined,
    finalizedAt: raw.finalized_at ? new Date(raw.finalized_at) : undefined,
    createdAt: new Date(raw.created_at),
  }
}

export function toBuildLogEvent(raw: ApiBuildLogEvent): BuildLogEvent {
  if (!raw.timestamp) throw new SandboxError("Invalid log event: missing timestamp")
  if (!raw.stream) throw new SandboxError("Invalid log event: missing stream")

  return {
    timestamp: new Date(raw.timestamp),
    stream: raw.stream as BuildLogStream,
    text: raw.text ?? "",
    finished: raw.finished,
    status: raw.status as BuildLogEvent["status"],
  }
}

/**
 * Pass-through for build steps since camelCase structure matches the API.
 * Kept as a function for future normalization (e.g. defaulting sudo).
 */
export function buildStepsToApi(steps: BuildStep[]): unknown[] {
  return steps.map((step) => step as unknown)
}
```

Also extend `SandboxCreateOptions` (modify in place — search for `interface SandboxCreateOptions`):

```ts
export interface SandboxCreateOptions extends ConnectionOptions {
  name: string
  /** Template alias, UUID, or Template instance. */
  fromTemplate?: string | { alias?: string; id: string }
  /** Snapshot UUID. */
  fromSnapshot?: string
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  network?: NetworkConfig
}
```

Using `{ alias?: string; id: string }` keeps types.ts from importing `Template` (avoids circular import). The `Template` class structurally satisfies this.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bunx turbo run test --filter=@superserve/sdk -- types.test.ts
```
Expected: PASS all.

- [ ] **Step 5: Typecheck**

```bash
bunx turbo run typecheck --filter=@superserve/sdk
```
Expected: no errors.

- [ ] **Step 6: Commit** *(user to review/run)*

```bash
git add packages/sdk/src/types.ts packages/sdk/tests/types.test.ts
git commit -m "sdk: add template types and converters"
```

---

### Task 2: Add `BuildError` to `errors.ts`

**Files:**
- Modify: `packages/sdk/src/errors.ts`
- Test: `packages/sdk/tests/errors.test.ts` *(create if absent)*

- [ ] **Step 1: Write failing tests**

Create `packages/sdk/tests/errors.test.ts` (or append if exists):

```ts
import { describe, expect, it } from "vitest"
import { BuildError, SandboxError } from "../src/errors.js"

describe("BuildError", () => {
  it("extends SandboxError", () => {
    const err = new BuildError("step_failed: boom", {
      code: "step_failed",
      buildId: "b-1",
      templateId: "t-1",
      statusCode: 200,
    })
    expect(err).toBeInstanceOf(SandboxError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("BuildError")
  })

  it("exposes code, buildId, templateId", () => {
    const err = new BuildError("build_failed: boom", {
      code: "build_failed",
      buildId: "b-2",
      templateId: "t-2",
    })
    expect(err.code).toBe("build_failed")
    expect(err.buildId).toBe("b-2")
    expect(err.templateId).toBe("t-2")
    expect(err.message).toBe("build_failed: boom")
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- errors.test.ts
```
Expected: FAIL — `BuildError` not exported.

- [ ] **Step 3: Implement `BuildError`**

Append to `packages/sdk/src/errors.ts`:

```ts
/**
 * Thrown by `Template.waitUntilReady()` when the awaited build lands on
 * status `failed`. `code` is the stable error prefix on the `error_message`
 * field — e.g. `image_pull_failed`, `step_failed`, `boot_failed`,
 * `snapshot_failed`, `start_cmd_failed`, `ready_cmd_failed`, `build_failed`.
 */
export class BuildError extends SandboxError {
  readonly code: string
  readonly buildId: string
  readonly templateId: string

  constructor(
    message: string,
    opts: {
      code: string
      buildId: string
      templateId: string
      statusCode?: number
    },
  ) {
    super(message, { statusCode: opts.statusCode, code: opts.code })
    this.name = "BuildError"
    this.code = opts.code
    this.buildId = opts.buildId
    this.templateId = opts.templateId
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/sdk -- errors.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/errors.ts packages/sdk/tests/errors.test.ts
git commit -m "sdk: add BuildError class"
```

---

### Task 3: Extend `streamSSE` with method override + no-body support

**Files:**
- Modify: `packages/sdk/src/http.ts`
- Test: `packages/sdk/tests/http.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/sdk/tests/http.test.ts`:

```ts
describe("streamSSE with GET", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses GET and omits body when method=GET", async () => {
    const sseLines = [
      'data: {"stream":"stdout","text":"hello","timestamp":"2026-01-01T00:00:00Z"}',
      "",
      'data: {"stream":"system","text":"done","timestamp":"2026-01-01T00:00:01Z","finished":true,"status":"ready"}',
      "",
    ].join("\n")

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseLines))
        controller.close()
      },
    })

    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const events: unknown[] = []
    await streamSSE({
      url: "https://api.example.com/templates/t-1/builds/b-1/logs",
      headers: { "X-API-Key": "k" },
      method: "GET",
      onEvent: (ev) => events.push(ev),
    })

    expect(mock).toHaveBeenCalledTimes(1)
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("GET")
    expect(init.body).toBeUndefined()
    expect(events.length).toBe(2)
  })
})
```

Make sure `streamSSE` is imported at the top of `http.test.ts`:

```ts
import { streamSSE } from "../src/http.js"
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- http.test.ts
```
Expected: FAIL — `method` option not recognized / `body` still sent.

- [ ] **Step 3: Extend `streamSSE` signature**

In `packages/sdk/src/http.ts`, modify the signature and body-handling logic around line 395:

```ts
export async function streamSSE(opts: {
  url: string
  headers: Record<string, string>
  body?: unknown
  method?: "GET" | "POST"
  timeoutMs?: number
  signal?: AbortSignal
  onEvent: (event: ApiExecStreamEvent) => void
}): Promise<void> {
  const {
    url,
    headers,
    body,
    method = "POST",
    timeoutMs = 300_000,
    signal: userSignal,
    onEvent,
  } = opts
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const signal = composeSignals(controller.signal, userSignal)

  try {
    const init: RequestInit = {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      signal,
    }
    if (method === "POST") {
      init.body = JSON.stringify(body ?? {})
    }

    const res = await fetch(url, init)

    // ... rest of existing body unchanged
```

Keep the rest of the function (reader loop, error mapping, timeout cleanup) identical.

Also, the event type argument is now too narrow (`ApiExecStreamEvent`). Loosen it to a generic:

```ts
export async function streamSSE<TEvent = ApiExecStreamEvent>(opts: {
  url: string
  headers: Record<string, string>
  body?: unknown
  method?: "GET" | "POST"
  timeoutMs?: number
  signal?: AbortSignal
  onEvent: (event: TEvent) => void
}): Promise<void> {
```

In the reader loop, cast the parsed JSON to `TEvent`:

```ts
// ...inside the for-each-line loop
onEvent(JSON.parse(data) as TEvent)
```

- [ ] **Step 4: Confirm tests pass (all http tests, not just new)**

```bash
bunx turbo run test --filter=@superserve/sdk -- http.test.ts
```
Expected: PASS — both the new GET test and all existing POST tests.

- [ ] **Step 5: Typecheck (ensure `commands.ts` still compiles)**

```bash
bunx turbo run typecheck --filter=@superserve/sdk
```
Expected: no errors. The existing `streamSSE<ApiExecStreamEvent>(...)` call site in `commands.ts` will infer the default generic.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/http.ts packages/sdk/tests/http.test.ts
git commit -m "sdk: extend streamSSE with method + generic event type"
```

---

## Phase 2 — TypeScript SDK Template class (CRUD)

### Task 4: Create `Template.ts` with static factories

**Files:**
- Create: `packages/sdk/src/Template.ts`
- Test: `packages/sdk/tests/template.test.ts`

- [ ] **Step 1: Write failing tests for static factories**

Create `packages/sdk/tests/template.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { NotFoundError } from "../src/errors.js"
import { Template } from "../src/Template.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(status: number, code = "error", message = "boom"): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseTemplate = {
  id: "t-1",
  team_id: "team-1",
  alias: "my-env",
  status: "building",
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: "2026-01-01T00:00:00Z",
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Template.create", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("POSTs /templates with flattened BuildSpec", async () => {
    const mock = vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" }))
    vi.stubGlobal("fetch", mock)

    const template = await Template.create({
      ...commonOpts,
      alias: "my-env",
      vcpu: 2,
      memoryMib: 2048,
      diskMib: 4096,
      from: "python:3.11",
      steps: [{ run: "pip install numpy" }, { env: { key: "DEBUG", value: "1" } }],
      startCmd: "python server.py",
      readyCmd: "curl -f http://localhost:8080/",
    })

    expect(template.id).toBe("t-1")
    expect(template.alias).toBe("my-env")
    expect(template.latestBuildId).toBe("b-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      alias: "my-env",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 4096,
      build_spec: {
        from: "python:3.11",
        steps: [
          { run: "pip install numpy" },
          { env: { key: "DEBUG", value: "1" } },
        ],
        start_cmd: "python server.py",
        ready_cmd: "curl -f http://localhost:8080/",
      },
    })
  })

  it("omits resource fields and start/ready when not provided", async () => {
    const mock = vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" }))
    vi.stubGlobal("fetch", mock)

    await Template.create({ ...commonOpts, alias: "x", from: "python:3.11" })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ alias: "x", build_spec: { from: "python:3.11" } })
  })

  it("throws when build_id missing from response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(baseTemplate)))
    await expect(
      Template.create({ ...commonOpts, alias: "x", from: "python:3.11" }),
    ).rejects.toThrow(/missing build_id/)
  })
})

describe("Template.connect", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /templates/{id}", async () => {
    const mock = vi.fn(async () => jsonResponse(baseTemplate))
    vi.stubGlobal("fetch", mock)

    const template = await Template.connect("my-env", commonOpts)

    expect(template.id).toBe("t-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/my-env")
    expect(init.method).toBe("GET")
  })
})

describe("Template.list", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /templates without filter", async () => {
    const mock = vi.fn(async () => jsonResponse([baseTemplate]))
    vi.stubGlobal("fetch", mock)

    const list = await Template.list(commonOpts)
    expect(list).toHaveLength(1)
    expect(list[0].alias).toBe("my-env")
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates")
  })

  it("appends alias_prefix query param", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Template.list({ ...commonOpts, aliasPrefix: "my-" })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates?alias_prefix=my-")
  })
})

describe("Template.deleteById", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("DELETEs /templates/{id}", async () => {
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await Template.deleteById("my-env", commonOpts)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/my-env")
    expect(init.method).toBe("DELETE")
  })

  it("swallows 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(404, "not_found")))
    await expect(Template.deleteById("missing", commonOpts)).resolves.toBeUndefined()
  })

  it("throws other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(409, "conflict")))
    await expect(Template.deleteById("busy", commonOpts)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- template.test.ts
```
Expected: FAIL — `Template` class not found.

- [ ] **Step 3: Create `Template.ts` with static factories**

Create `packages/sdk/src/Template.ts`:

```ts
/**
 * Template class — reusable sandbox base image with build steps.
 *
 * ```typescript
 * import { Template, Sandbox } from "@superserve/sdk"
 *
 * const template = await Template.create({
 *   alias: "my-python-env",
 *   from: "python:3.11",
 *   steps: [{ run: "pip install numpy" }],
 * })
 * await template.waitUntilReady()
 * const sandbox = await Sandbox.create({ name: "run-1", fromTemplate: template })
 * ```
 */

import { type ResolvedConfig, resolveConfig } from "./config.js"
import {
  BuildError,
  ConflictError,
  NotFoundError,
  SandboxError,
} from "./errors.js"
import { request, requestVoid, streamSSE } from "./http.js"
import type {
  ApiBuildLogEvent,
  ApiCreateTemplateResponse,
  ApiTemplateBuildResponse,
  ApiTemplateResponse,
  BuildLogEvent,
  BuildLogsOptions,
  ConnectionOptions,
  TemplateBuildInfo,
  TemplateBuildsListOptions,
  TemplateCreateOptions,
  TemplateInfo,
  TemplateListOptions,
  TemplateStatus,
  WaitUntilReadyOptions,
} from "./types.js"
import {
  buildStepsToApi,
  toBuildLogEvent,
  toTemplateBuildInfo,
  toTemplateInfo,
} from "./types.js"

export class Template {
  readonly id: string
  readonly alias: string
  readonly teamId: string
  readonly status: TemplateStatus
  readonly vcpu: number
  readonly memoryMib: number
  readonly diskMib: number
  readonly sizeBytes?: number
  readonly errorMessage?: string
  readonly createdAt: Date
  readonly builtAt?: Date
  readonly latestBuildId?: string

  private readonly _config: ResolvedConfig

  /** @internal — use `Template.create()` / `Template.connect()` instead. */
  private constructor(info: TemplateInfo, config: ResolvedConfig) {
    this.id = info.id
    this.alias = info.alias
    this.teamId = info.teamId
    this.status = info.status
    this.vcpu = info.vcpu
    this.memoryMib = info.memoryMib
    this.diskMib = info.diskMib
    this.sizeBytes = info.sizeBytes
    this.errorMessage = info.errorMessage
    this.createdAt = info.createdAt
    this.builtAt = info.builtAt
    this.latestBuildId = info.latestBuildId
    this._config = config
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  static async create(options: TemplateCreateOptions): Promise<Template> {
    const config = resolveConfig(options)

    const buildSpec: Record<string, unknown> = { from: options.from }
    if (options.steps !== undefined) buildSpec.steps = buildStepsToApi(options.steps)
    if (options.startCmd !== undefined) buildSpec.start_cmd = options.startCmd
    if (options.readyCmd !== undefined) buildSpec.ready_cmd = options.readyCmd

    const body: Record<string, unknown> = {
      alias: options.alias,
      build_spec: buildSpec,
    }
    if (options.vcpu !== undefined) body.vcpu = options.vcpu
    if (options.memoryMib !== undefined) body.memory_mib = options.memoryMib
    if (options.diskMib !== undefined) body.disk_mib = options.diskMib

    const raw = await request<ApiCreateTemplateResponse>({
      method: "POST",
      url: `${config.baseUrl}/templates`,
      headers: { "X-API-Key": config.apiKey },
      body,
      signal: options.signal,
    })

    if (!raw.build_id) {
      throw new SandboxError(
        "Invalid API response from POST /templates: missing build_id",
      )
    }
    return new Template(toTemplateInfo(raw, raw.build_id), config)
  }

  static async connect(
    aliasOrId: string,
    options: ConnectionOptions = {},
  ): Promise<Template> {
    const config = resolveConfig(options)
    const raw = await request<ApiTemplateResponse>({
      method: "GET",
      url: `${config.baseUrl}/templates/${encodeURIComponent(aliasOrId)}`,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return new Template(toTemplateInfo(raw), config)
  }

  static async list(
    options: TemplateListOptions = {},
  ): Promise<TemplateInfo[]> {
    const config = resolveConfig(options)
    let url = `${config.baseUrl}/templates`
    if (options.aliasPrefix) {
      const qs = new URLSearchParams({ alias_prefix: options.aliasPrefix })
      url += `?${qs.toString()}`
    }

    const raw = await request<ApiTemplateResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": config.apiKey },
      signal: options.signal,
    })
    return raw.map((t) => toTemplateInfo(t))
  }

  static async deleteById(
    aliasOrId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    try {
      await requestVoid({
        method: "DELETE",
        url: `${config.baseUrl}/templates/${encodeURIComponent(aliasOrId)}`,
        headers: { "X-API-Key": config.apiKey },
        signal: options.signal,
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/sdk -- template.test.ts
```
Expected: PASS static factory tests.

- [ ] **Step 5: Typecheck**

```bash
bunx turbo run typecheck --filter=@superserve/sdk
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/Template.ts packages/sdk/tests/template.test.ts
git commit -m "sdk: add Template class with static factories"
```

---

### Task 5: Add instance methods — `getInfo`, `delete`, `rebuild`, builds

**Files:**
- Modify: `packages/sdk/src/Template.ts`
- Test: `packages/sdk/tests/template.test.ts`

- [ ] **Step 1: Write failing tests (append to `template.test.ts`)**

```ts
describe("Template instance methods", () => {
  afterEach(() => vi.unstubAllGlobals())

  const fullTemplate = { ...baseTemplate, build_id: "b-1" }

  async function createTemplate() {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fullTemplate)))
    const t = await Template.create({ ...commonOpts, alias: "my-env", from: "python:3.11" })
    vi.unstubAllGlobals()
    return t
  }

  it("getInfo refreshes from GET /templates/{id}", async () => {
    const t = await createTemplate()
    const updated = { ...baseTemplate, status: "ready" }
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(updated)))

    const info = await t.getInfo()
    expect(info.status).toBe("ready")
  })

  it("delete DELETEs the template (idempotent on 404)", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => errorResponse(404, "not_found"))
    vi.stubGlobal("fetch", mock)

    await expect(t.delete()).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("delete throws on 409 (has active sandboxes)", async () => {
    const t = await createTemplate()
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(409, "conflict")))
    await expect(t.delete()).rejects.toThrow()
  })

  it("rebuild POSTs /templates/{id}/builds", async () => {
    const t = await createTemplate()
    const build = {
      id: "b-2",
      template_id: "t-1",
      status: "building",
      build_spec_hash: "h",
      created_at: "2026-01-01T00:00:00Z",
    }
    const mock = vi.fn(async () => jsonResponse(build, 201))
    vi.stubGlobal("fetch", mock)

    const info = await t.rebuild()
    expect(info.id).toBe("b-2")
    expect(info.templateId).toBe("t-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds")
    expect(init.method).toBe("POST")
  })

  it("listBuilds GETs with optional limit", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await t.listBuilds({ limit: 5 })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds?limit=5")
  })

  it("getBuild GETs /templates/{id}/builds/{build_id}", async () => {
    const t = await createTemplate()
    const build = {
      id: "b-1",
      template_id: "t-1",
      status: "building",
      build_spec_hash: "h",
      created_at: "2026-01-01T00:00:00Z",
    }
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(build)))

    const info = await t.getBuild("b-1")
    expect(info.id).toBe("b-1")
  })

  it("cancelBuild DELETEs the build", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await t.cancelBuild("b-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-1")
    expect(init.method).toBe("DELETE")
  })

  it("cancelBuild is idempotent on 404", async () => {
    const t = await createTemplate()
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(404, "not_found")))
    await expect(t.cancelBuild("b-1")).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- template.test.ts
```
Expected: FAIL — instance methods missing.

- [ ] **Step 3: Add instance methods to `Template.ts`**

Append before the closing `}` of the `Template` class in `packages/sdk/src/Template.ts`:

```ts
  // -------------------------------------------------------------------------
  // Instance methods
  // -------------------------------------------------------------------------

  async getInfo(): Promise<TemplateInfo> {
    const raw = await request<ApiTemplateResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateInfo(raw)
  }

  async delete(): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }

  async rebuild(): Promise<TemplateBuildInfo> {
    const raw = await request<ApiTemplateBuildResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateBuildInfo(raw)
  }

  async listBuilds(
    options: TemplateBuildsListOptions = {},
  ): Promise<TemplateBuildInfo[]> {
    let url = `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds`
    if (options.limit !== undefined) {
      url += `?limit=${options.limit}`
    }
    const raw = await request<ApiTemplateBuildResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
    })
    return raw.map(toTemplateBuildInfo)
  }

  async getBuild(buildId: string): Promise<TemplateBuildInfo> {
    const raw = await request<ApiTemplateBuildResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    return toTemplateBuildInfo(raw)
  }

  async cancelBuild(buildId: string): Promise<void> {
    try {
      await requestVoid({
        method: "DELETE",
        url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}`,
        headers: { "X-API-Key": this._config.apiKey },
      })
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }
  }
```

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/sdk -- template.test.ts
```
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/Template.ts packages/sdk/tests/template.test.ts
git commit -m "sdk: add Template instance methods (getInfo, delete, rebuild, builds)"
```

---

### Task 6: Add `streamBuildLogs` + `waitUntilReady`

**Files:**
- Modify: `packages/sdk/src/Template.ts`
- Test: `packages/sdk/tests/build-logs.test.ts`

- [ ] **Step 1: Create the test file**

Create `packages/sdk/tests/build-logs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BuildError, ConflictError } from "../src/errors.js"
import { Template } from "../src/Template.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sseStream(lines: string[]): ReadableStream {
  const payload = lines.join("\n") + "\n"
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
}

const baseTemplate = {
  id: "t-1",
  team_id: "team-1",
  alias: "my-env",
  status: "building",
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: "2026-01-01T00:00:00Z",
}
const commonOpts = { apiKey: "k", baseUrl: "https://api.superserve.ai" }

async function makeTemplate() {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" })))
  const t = await Template.create({ ...commonOpts, alias: "my-env", from: "python:3.11" })
  vi.unstubAllGlobals()
  return t
}

describe("Template.streamBuildLogs", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /logs and forwards events via onEvent", async () => {
    const t = await makeTemplate()
    const stream = sseStream([
      'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hello"}',
      "",
      'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
      "",
    ])
    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const events: Array<{ stream: string; text: string }> = []
    await t.streamBuildLogs({ onEvent: (ev) => events.push({ stream: ev.stream, text: ev.text }) })

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-1/logs")
    expect(init.method).toBe("GET")
    expect(events).toEqual([
      { stream: "stdout", text: "hello" },
      { stream: "system", text: "done" },
    ])
  })

  it("uses provided buildId when passed", async () => {
    const t = await makeTemplate()
    const stream = sseStream([])
    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    await t.streamBuildLogs({ onEvent: () => {}, buildId: "b-2" })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-2/logs")
  })

  it("throws when buildId missing and no latestBuildId", async () => {
    // Manually construct via Template.connect (no build_id in response)
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(baseTemplate)))
    const t = await Template.connect("my-env", commonOpts)
    vi.unstubAllGlobals()

    await expect(t.streamBuildLogs({ onEvent: () => {} })).rejects.toThrow(/buildId required/)
  })
})

describe("Template.waitUntilReady", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("resolves when SSE final event has status 'ready'", async () => {
    const t = await makeTemplate()
    const readyTemplate = { ...baseTemplate, status: "ready" }

    // First fetch: SSE stream; second fetch: getInfo refresh
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(
          sseStream([
            'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"built"}',
            "",
            'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
            "",
          ]),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(async () => jsonResponse(readyTemplate))
    vi.stubGlobal("fetch", fetchMock)

    const logs: string[] = []
    const info = await t.waitUntilReady({ onLog: (ev) => logs.push(ev.text) })
    expect(info.status).toBe("ready")
    expect(logs).toContain("built")
  })

  it("throws BuildError when SSE final event has status 'failed'", async () => {
    const t = await makeTemplate()
    const failedTemplate = {
      ...baseTemplate,
      status: "failed",
      error_message: "step_failed: step 1/1 failed after 3s: exited with code 100",
    }
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(
          sseStream([
            'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"failed","finished":true,"status":"failed"}',
            "",
          ]),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(async () => jsonResponse(failedTemplate))
    vi.stubGlobal("fetch", fetchMock)

    await expect(t.waitUntilReady()).rejects.toMatchObject({
      name: "BuildError",
      code: "step_failed",
      buildId: "b-1",
      templateId: "t-1",
    })
  })

  it("throws ConflictError on status 'cancelled'", async () => {
    const t = await makeTemplate()
    const cancelledTemplate = { ...baseTemplate, status: "failed" }
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(
          sseStream([
            'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"cancelled","finished":true,"status":"cancelled"}',
            "",
          ]),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(async () => jsonResponse(cancelledTemplate))
    vi.stubGlobal("fetch", fetchMock)

    await expect(t.waitUntilReady()).rejects.toBeInstanceOf(ConflictError)
  })

  it("falls back to polling when SSE errors", async () => {
    const t = await makeTemplate()
    const readyTemplate = { ...baseTemplate, status: "ready" }

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        // SSE errors
        throw new Error("network")
      })
      // Then polling kicks in:
      .mockImplementationOnce(async () => jsonResponse(readyTemplate))
    vi.stubGlobal("fetch", fetchMock)

    const info = await t.waitUntilReady({ pollIntervalMs: 1 })
    expect(info.status).toBe("ready")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- build-logs.test.ts
```
Expected: FAIL — `streamBuildLogs` / `waitUntilReady` not defined.

- [ ] **Step 3: Implement the methods**

Append to `packages/sdk/src/Template.ts` (inside the class, before the closing `}`):

```ts
  async streamBuildLogs(options: BuildLogsOptions): Promise<void> {
    const buildId = options.buildId ?? this.latestBuildId
    if (!buildId) {
      throw new SandboxError("buildId required: no latest build recorded")
    }
    await streamSSE<ApiBuildLogEvent>({
      method: "GET",
      url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}/logs`,
      headers: { "X-API-Key": this._config.apiKey },
      signal: options.signal,
      onEvent: (raw) => options.onEvent(toBuildLogEvent(raw)),
    })
  }

  async waitUntilReady(
    options: WaitUntilReadyOptions = {},
  ): Promise<TemplateInfo> {
    const pollMs = options.pollIntervalMs ?? 2000
    const buildId = this.latestBuildId

    const parseBuildErrorCode = (message?: string): string => {
      if (!message) return "build_failed"
      const match = /^(\w+):/.exec(message)
      return match ? match[1] : "build_failed"
    }

    let finalStatus: "ready" | "failed" | "cancelled" | undefined

    if (buildId) {
      try {
        await streamSSE<ApiBuildLogEvent>({
          method: "GET",
          url: `${this._config.baseUrl}/templates/${encodeURIComponent(this.id)}/builds/${encodeURIComponent(buildId)}/logs`,
          headers: { "X-API-Key": this._config.apiKey },
          signal: options.signal,
          onEvent: (raw) => {
            const ev = toBuildLogEvent(raw)
            if (options.onLog) options.onLog(ev)
            if (ev.finished && ev.status) finalStatus = ev.status
          },
        })
      } catch {
        // Fall through to polling.
      }
    }

    // Poll until terminal status (handles both SSE-error and no-buildId cases).
    while (finalStatus === undefined) {
      if (options.signal?.aborted) throw new SandboxError("aborted")
      const info = await this.getInfo()
      if (info.status === "ready" || info.status === "failed") {
        finalStatus = info.status as "ready" | "failed"
        break
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }

    const info = await this.getInfo()
    if (finalStatus === "ready") return info
    if (finalStatus === "cancelled") {
      throw new ConflictError("template build was cancelled", {
        code: "cancelled",
      })
    }
    // failed
    throw new BuildError(info.errorMessage ?? "build_failed", {
      code: parseBuildErrorCode(info.errorMessage),
      buildId: buildId ?? "",
      templateId: this.id,
    })
  }
```

Note: `ConflictError` needs to be constructable with `{ code }`. Verify the existing signature in `errors.ts` — if it takes a different shape, adjust accordingly (the existing `mapApiError` constructs them, so the shape is established). If it only takes `(message: string, opts: { statusCode?, code? })`, the call above works as-is.

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/sdk -- build-logs.test.ts
```
Expected: PASS all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/Template.ts packages/sdk/tests/build-logs.test.ts
git commit -m "sdk: add Template.streamBuildLogs and waitUntilReady"
```

---

## Phase 3 — TypeScript SDK Sandbox integration + exports

### Task 7: Extend `Sandbox.create` with `fromTemplate` / `fromSnapshot`

**Files:**
- Modify: `packages/sdk/src/Sandbox.ts`
- Test: `packages/sdk/tests/sandbox.test.ts`

- [ ] **Step 1: Write failing tests (append to `sandbox.test.ts`)**

```ts
describe("Sandbox.create fromTemplate / fromSnapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("maps fromTemplate (string) to from_template body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: "superserve/python-3.11",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("superserve/python-3.11")
  })

  it("extracts alias from Template instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { alias: "my-env", id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("my-env")
  })

  it("falls back to id when alias is undefined", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("t-1")
  })

  it("maps fromSnapshot to from_snapshot body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromSnapshot: "snap-abc",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_snapshot).toBe("snap-abc")
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/sdk -- sandbox.test.ts
```
Expected: FAIL — body doesn't include `from_template` / `from_snapshot`.

- [ ] **Step 3: Extend `Sandbox.create`**

In `packages/sdk/src/Sandbox.ts`, inside `static async create`, after the existing body construction (after `if (options.timeoutSeconds !== undefined)` block), add:

```ts
    if (options.fromTemplate !== undefined) {
      body.from_template =
        typeof options.fromTemplate === "string"
          ? options.fromTemplate
          : options.fromTemplate.alias ?? options.fromTemplate.id
    }
    if (options.fromSnapshot !== undefined) {
      body.from_snapshot = options.fromSnapshot
    }
```

- [ ] **Step 4: Confirm tests pass (all sandbox tests)**

```bash
bunx turbo run test --filter=@superserve/sdk -- sandbox.test.ts
```
Expected: PASS all new + existing.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/Sandbox.ts packages/sdk/tests/sandbox.test.ts
git commit -m "sdk: Sandbox.create accepts fromTemplate and fromSnapshot"
```

---

### Task 8: Public exports — `index.ts`

**Files:**
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Update exports**

Replace `packages/sdk/src/index.ts`:

```ts
/**
 * Superserve SDK — sandbox infrastructure for running code in isolated cloud environments.
 */

export {
  AuthenticationError,
  BuildError,
  ConflictError,
  NotFoundError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "./errors.js"
export { Sandbox } from "./Sandbox.js"
export { Template } from "./Template.js"
export type {
  BuildLogEvent,
  BuildLogsOptions,
  BuildLogStream,
  BuildStep,
  CommandOptions,
  CommandResult,
  ConnectionOptions,
  FileInput,
  NetworkConfig,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
  SandboxStatus,
  SandboxUpdateOptions,
  TemplateBuildInfo,
  TemplateBuildsListOptions,
  TemplateBuildStatus,
  TemplateCreateOptions,
  TemplateInfo,
  TemplateListOptions,
  TemplateStatus,
  WaitUntilReadyOptions,
} from "./types.js"
```

- [ ] **Step 2: Typecheck & test**

```bash
bunx turbo run typecheck --filter=@superserve/sdk
bunx turbo run test --filter=@superserve/sdk
```
Expected: no errors; all tests pass.

- [ ] **Step 3: Build**

```bash
bunx turbo run build --filter=@superserve/sdk
```
Expected: builds `dist/`.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/index.ts
git commit -m "sdk: export Template, BuildError, and new types"
```

---

### Task 9: TypeScript SDK end-to-end test

**Files:**
- Create: `tests/sdk-e2e-ts/src/tests/templates.test.ts`

- [ ] **Step 1: Check existing e2e structure**

Read `tests/sdk-e2e-ts/src/tests/sandbox.test.ts` to see the helper imports (`describeIfCredentials`, `expectE2E`) and the overall pattern — mirror that shape.

- [ ] **Step 2: Write the e2e test**

Create `tests/sdk-e2e-ts/src/tests/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { Template, Sandbox, BuildError } from "@superserve/sdk"

const API_KEY = process.env.SUPERSERVE_API_KEY
const BASE_URL = process.env.SUPERSERVE_BASE_URL ?? "https://api-staging.superserve.ai"

const describeIfCredentials = API_KEY ? describe : describe.skip

describeIfCredentials("Templates e2e", () => {
  it("lists templates (includes system templates)", async () => {
    const list = await Template.list({ apiKey: API_KEY!, baseUrl: BASE_URL })
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((t) => t.alias.startsWith("superserve/"))).toBe(true)
  })

  it("creates a template, waits for ready, launches a sandbox from it, cleans up", async () => {
    const alias = `e2e-tpl-${Date.now()}`
    const template = await Template.create({
      apiKey: API_KEY!,
      baseUrl: BASE_URL,
      alias,
      from: "python:3.11",
      steps: [{ run: "echo hello > /tmp/marker" }],
    })
    expect(template.alias).toBe(alias)

    try {
      await template.waitUntilReady({
        onLog: (ev) => {
          if (ev.stream === "stdout" || ev.stream === "stderr") {
            process.stdout.write(ev.text)
          }
        },
      })

      const fresh = await template.getInfo()
      expect(fresh.status).toBe("ready")

      const sandbox = await Sandbox.create({
        apiKey: API_KEY!,
        baseUrl: BASE_URL,
        name: `e2e-sbx-${Date.now()}`,
        fromTemplate: template,
      })
      try {
        const result = await sandbox.commands.run("cat /tmp/marker")
        expect(result.stdout.trim()).toBe("hello")
      } finally {
        await sandbox.kill()
      }
    } finally {
      await template.delete()
    }
  }, 300_000) // 5 min timeout for build
})
```

- [ ] **Step 3: Run (optional — requires credentials)**

```bash
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-ts -- templates
```
Expected: PASS (or skip if no credentials).

- [ ] **Step 4: Commit**

```bash
git add tests/sdk-e2e-ts/src/tests/templates.test.ts
git commit -m "sdk-e2e: add templates end-to-end test"
```

---

## Phase 4 — Python SDK foundation

### Task 10: Add template types to `types.py`

**Files:**
- Modify: `packages/python-sdk/src/superserve/types.py`
- Test: `packages/python-sdk/tests/test_types.py`

- [ ] **Step 1: Write failing tests**

Append to `packages/python-sdk/tests/test_types.py`:

```python
from __future__ import annotations

from datetime import datetime

from superserve.types import (
    BuildLogEvent,
    EnvStep,
    EnvStepValue,
    RunStep,
    TemplateBuildInfo,
    TemplateBuildStatus,
    TemplateInfo,
    TemplateStatus,
    UserStep,
    UserStepValue,
    WorkdirStep,
    build_steps_to_api,
    to_build_log_event,
    to_template_build_info,
    to_template_info,
)


class TestToTemplateInfo:
    def test_basic(self) -> None:
        info = to_template_info({
            "id": "t-1",
            "team_id": "team-1",
            "alias": "my-env",
            "status": "ready",
            "vcpu": 2,
            "memory_mib": 2048,
            "disk_mib": 4096,
            "size_bytes": 12345,
            "created_at": "2026-01-01T00:00:00Z",
            "built_at": "2026-01-01T00:01:00Z",
        })
        assert info.id == "t-1"
        assert info.alias == "my-env"
        assert info.status == TemplateStatus.READY
        assert info.vcpu == 2
        assert info.memory_mib == 2048
        assert info.disk_mib == 4096
        assert info.size_bytes == 12345
        assert isinstance(info.created_at, datetime)
        assert isinstance(info.built_at, datetime)

    def test_optional_fields_absent(self) -> None:
        info = to_template_info({
            "id": "t-1",
            "team_id": "team-1",
            "alias": "my-env",
            "status": "building",
            "vcpu": 1,
            "memory_mib": 1024,
            "disk_mib": 4096,
            "created_at": "2026-01-01T00:00:00Z",
        })
        assert info.size_bytes is None
        assert info.built_at is None
        assert info.error_message is None


class TestToTemplateBuildInfo:
    def test_basic(self) -> None:
        b = to_template_build_info({
            "id": "b-1",
            "template_id": "t-1",
            "status": "ready",
            "build_spec_hash": "h",
            "started_at": "2026-01-01T00:00:00Z",
            "finalized_at": "2026-01-01T00:01:00Z",
            "created_at": "2026-01-01T00:00:00Z",
        })
        assert b.id == "b-1"
        assert b.template_id == "t-1"
        assert b.status == TemplateBuildStatus.READY
        assert b.build_spec_hash == "h"


class TestToBuildLogEvent:
    def test_basic(self) -> None:
        ev = to_build_log_event({
            "timestamp": "2026-01-01T00:00:00Z",
            "stream": "stdout",
            "text": "hello",
            "finished": True,
            "status": "ready",
        })
        assert ev.text == "hello"
        assert ev.finished is True
        assert ev.status == "ready"


class TestBuildStepsToApi:
    def test_run(self) -> None:
        out = build_steps_to_api([RunStep(run="echo hello")])
        assert out == [{"run": "echo hello"}]

    def test_env(self) -> None:
        out = build_steps_to_api([EnvStep(env=EnvStepValue(key="DEBUG", value="1"))])
        assert out == [{"env": {"key": "DEBUG", "value": "1"}}]

    def test_workdir(self) -> None:
        out = build_steps_to_api([WorkdirStep(workdir="/app")])
        assert out == [{"workdir": "/app"}]

    def test_user_default_sudo_false(self) -> None:
        out = build_steps_to_api([UserStep(user=UserStepValue(name="appuser"))])
        assert out == [{"user": {"name": "appuser", "sudo": False}}]

    def test_user_sudo_true(self) -> None:
        out = build_steps_to_api([UserStep(user=UserStepValue(name="appuser", sudo=True))])
        assert out == [{"user": {"name": "appuser", "sudo": True}}]
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- -k "template"
```
Expected: FAIL — imports fail.

- [ ] **Step 3: Add types to `types.py`**

Append to `packages/python-sdk/src/superserve/types.py`:

```python
from enum import Enum
from pydantic import BaseModel


class TemplateStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


class TemplateBuildStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    SNAPSHOTTING = "snapshotting"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BuildLogStream(str, Enum):
    STDOUT = "stdout"
    STDERR = "stderr"
    SYSTEM = "system"


class TemplateInfo(BaseModel):
    id: str
    alias: str
    team_id: str
    status: TemplateStatus
    vcpu: int
    memory_mib: int
    disk_mib: int
    size_bytes: int | None = None
    error_message: str | None = None
    created_at: datetime
    built_at: datetime | None = None
    latest_build_id: str | None = None


class TemplateBuildInfo(BaseModel):
    id: str
    template_id: str
    status: TemplateBuildStatus
    build_spec_hash: str
    error_message: str | None = None
    started_at: datetime | None = None
    finalized_at: datetime | None = None
    created_at: datetime


class BuildLogEvent(BaseModel):
    timestamp: datetime
    stream: BuildLogStream
    text: str = ""
    finished: bool | None = None
    status: str | None = None  # ready | failed | cancelled


# BuildStep discriminated union (mutually exclusive fields)
class RunStep(BaseModel):
    run: str


class EnvStepValue(BaseModel):
    key: str
    value: str


class EnvStep(BaseModel):
    env: EnvStepValue


class WorkdirStep(BaseModel):
    workdir: str


class UserStepValue(BaseModel):
    name: str
    sudo: bool = False


class UserStep(BaseModel):
    user: UserStepValue


BuildStep = RunStep | EnvStep | WorkdirStep | UserStep


# Converters (match existing to_sandbox_info pattern)
def to_template_info(
    raw: dict, latest_build_id: str | None = None
) -> TemplateInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing template id")
    if not raw.get("alias"):
        raise SandboxError("Invalid API response: missing template alias")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing template status")
    if not raw.get("team_id"):
        raise SandboxError("Invalid API response: missing team_id")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateInfo(
        id=raw["id"],
        alias=raw["alias"],
        team_id=raw["team_id"],
        status=TemplateStatus(raw["status"]),
        vcpu=raw.get("vcpu", 0),
        memory_mib=raw.get("memory_mib", 0),
        disk_mib=raw.get("disk_mib", 0),
        size_bytes=raw.get("size_bytes"),
        error_message=raw.get("error_message"),
        created_at=_parse_dt(raw["created_at"]),
        built_at=_parse_dt(raw["built_at"]) if raw.get("built_at") else None,
        latest_build_id=latest_build_id or raw.get("latest_build_id"),
    )


def to_template_build_info(raw: dict) -> TemplateBuildInfo:
    if not raw.get("id"):
        raise SandboxError("Invalid API response: missing build id")
    if not raw.get("template_id"):
        raise SandboxError("Invalid API response: missing template_id")
    if not raw.get("status"):
        raise SandboxError("Invalid API response: missing build status")
    if not raw.get("build_spec_hash"):
        raise SandboxError("Invalid API response: missing build_spec_hash")
    if not raw.get("created_at"):
        raise SandboxError("Invalid API response: missing created_at")

    return TemplateBuildInfo(
        id=raw["id"],
        template_id=raw["template_id"],
        status=TemplateBuildStatus(raw["status"]),
        build_spec_hash=raw["build_spec_hash"],
        error_message=raw.get("error_message"),
        started_at=_parse_dt(raw["started_at"]) if raw.get("started_at") else None,
        finalized_at=_parse_dt(raw["finalized_at"]) if raw.get("finalized_at") else None,
        created_at=_parse_dt(raw["created_at"]),
    )


def to_build_log_event(raw: dict) -> BuildLogEvent:
    if not raw.get("timestamp"):
        raise SandboxError("Invalid log event: missing timestamp")
    if not raw.get("stream"):
        raise SandboxError("Invalid log event: missing stream")

    return BuildLogEvent(
        timestamp=_parse_dt(raw["timestamp"]),
        stream=BuildLogStream(raw["stream"]),
        text=raw.get("text", ""),
        finished=raw.get("finished"),
        status=raw.get("status"),
    )


def build_steps_to_api(steps: list[BuildStep]) -> list[dict]:
    return [s.model_dump() for s in steps]
```

If `_parse_dt` isn't already defined in `types.py` (it's used by `to_sandbox_info`), reuse that helper — don't duplicate. Check the top of `types.py` first.

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- -k "template"
```
Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
bunx turbo run typecheck --filter=@superserve/python-sdk
```
Expected: no mypy errors.

- [ ] **Step 6: Commit**

```bash
git add packages/python-sdk/src/superserve/types.py packages/python-sdk/tests/test_types.py
git commit -m "python-sdk: add template types and converters"
```

---

### Task 11: Add `BuildError` to `errors.py`

**Files:**
- Modify: `packages/python-sdk/src/superserve/errors.py`
- Test: `packages/python-sdk/tests/test_errors.py`

- [ ] **Step 1: Failing test**

Append to `packages/python-sdk/tests/test_errors.py`:

```python
from superserve.errors import BuildError, SandboxError


class TestBuildError:
    def test_extends_sandbox_error(self) -> None:
        err = BuildError(
            "step_failed: boom",
            code="step_failed",
            build_id="b-1",
            template_id="t-1",
        )
        assert isinstance(err, SandboxError)
        assert isinstance(err, Exception)

    def test_exposes_code_build_id_template_id(self) -> None:
        err = BuildError(
            "build_failed: boom",
            code="build_failed",
            build_id="b-2",
            template_id="t-2",
        )
        assert err.code == "build_failed"
        assert err.build_id == "b-2"
        assert err.template_id == "t-2"
        assert str(err) == "build_failed: boom"
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- -k "BuildError"
```
Expected: FAIL — import error.

- [ ] **Step 3: Implement**

Append to `packages/python-sdk/src/superserve/errors.py`:

```python
class BuildError(SandboxError):
    """Raised when a template build transitions to status 'failed'.

    `code` is the stable error prefix on `error_message` (e.g. `image_pull_failed`,
    `step_failed`, `boot_failed`, `snapshot_failed`, `start_cmd_failed`,
    `ready_cmd_failed`, `build_failed`).
    """

    def __init__(
        self,
        message: str,
        *,
        code: str,
        build_id: str,
        template_id: str,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message, status_code=status_code, code=code)
        self.code = code
        self.build_id = build_id
        self.template_id = template_id
```

If the existing `SandboxError.__init__` signature differs (check the file), adjust the `super().__init__(...)` accordingly.

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- -k "BuildError"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/python-sdk/src/superserve/errors.py packages/python-sdk/tests/test_errors.py
git commit -m "python-sdk: add BuildError class"
```

---

### Task 12: Extend `stream_sse` / `async_stream_sse` with method override

**Files:**
- Modify: `packages/python-sdk/src/superserve/_http.py`
- Test: `packages/python-sdk/tests/test_http.py`

- [ ] **Step 1: Failing test**

Append to `packages/python-sdk/tests/test_http.py`:

```python
class TestStreamSSEGet:
    def test_uses_get_without_body(self) -> None:
        with respx.mock() as router:
            route = router.get("https://api.example.com/templates/t/builds/b/logs").mock(
                return_value=httpx.Response(
                    200,
                    text=(
                        'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hi"}\n\n'
                        'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}\n\n'
                    ),
                )
            )
            events: list[dict] = []
            stream_sse(
                "https://api.example.com/templates/t/builds/b/logs",
                headers={"X-API-Key": "k"},
                json_body=None,
                method="GET",
                on_event=lambda ev: events.append(ev),
            )
            assert len(events) == 2
            assert route.call_count == 1
            # GET request has no body
            assert route.calls.last.request.content == b""
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- -k "StreamSSEGet"
```
Expected: FAIL — `method` kwarg unknown.

- [ ] **Step 3: Extend sync `stream_sse`**

In `packages/python-sdk/src/superserve/_http.py`, modify `stream_sse` signature (around line 268):

```python
def stream_sse(
    url: str,
    *,
    headers: dict[str, str],
    json_body: Any,
    method: str = "POST",
    timeout: float = 300.0,
    on_event: Callable[[dict[str, Any]], None],
    client: httpx.Client | None = None,
) -> None:
    """Consume an SSE stream. Supports both POST (with body) and GET (no body)."""
    owned = client is None
    if owned:
        client = httpx.Client(timeout=timeout)
    assert client is not None

    merged = _default_headers(
        headers,
        content_type="application/json" if method == "POST" else None,
    )
    stream_kwargs: dict[str, Any] = {
        "headers": merged,
        "timeout": timeout,
    }
    if method == "POST":
        stream_kwargs["json"] = json_body

    try:
        with client.stream(method, url, **stream_kwargs) as response:
            # ... rest unchanged
```

Do the same for `async_stream_sse` further down.

- [ ] **Step 4: Confirm tests pass (all http tests)**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_http
```
Expected: PASS new + existing.

- [ ] **Step 5: Commit**

```bash
git add packages/python-sdk/src/superserve/_http.py packages/python-sdk/tests/test_http.py
git commit -m "python-sdk: extend stream_sse with method override"
```

---

## Phase 5 — Python SDK sync `Template` class

### Task 13: Create `template.py` with static factories + instance CRUD + builds

**Files:**
- Create: `packages/python-sdk/src/superserve/template.py`
- Test: `packages/python-sdk/tests/test_template.py`

- [ ] **Step 1: Write tests**

Create `packages/python-sdk/tests/test_template.py`:

```python
from __future__ import annotations

import httpx
import pytest
import respx
from superserve import Template, TemplateStatus

API = "https://api.example.com"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


BASE = {
    "id": "t-1",
    "team_id": "team-1",
    "alias": "my-env",
    "status": "building",
    "vcpu": 1,
    "memory_mib": 1024,
    "disk_mib": 4096,
    "created_at": "2026-01-01T00:00:00Z",
}


class TestCreate:
    def test_posts_flattened_build_spec(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = Template.create(
                alias="my-env",
                vcpu=2,
                memory_mib=2048,
                disk_mib=4096,
                from_="python:3.11",
                start_cmd="python server.py",
            )
            assert t.id == "t-1"
            assert t.latest_build_id == "b-1"
            body = route.calls.last.request.content
            assert b"python:3.11" in body
            assert b"start_cmd" in body
            assert b"vcpu" in body

    def test_throws_on_missing_build_id(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json=BASE)
            )
            with pytest.raises(Exception, match="missing build_id"):
                Template.create(alias="x", from_="python:3.11")


class TestConnect:
    def test_gets_template(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = Template.connect("my-env")
            assert t.alias == "my-env"


class TestList:
    def test_without_filter(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates").mock(
                return_value=httpx.Response(200, json=[BASE])
            )
            lst = Template.list()
            assert len(lst) == 1
            assert lst[0].alias == "my-env"

    def test_with_alias_prefix(self) -> None:
        with respx.mock() as router:
            route = router.get(f"{API}/templates", params={"alias_prefix": "my-"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            Template.list(alias_prefix="my-")
            assert route.call_count == 1


class TestDeleteById:
    def test_deletes(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(204)
            )
            Template.delete_by_id("my-env")

    def test_swallows_404(self) -> None:
        with respx.mock() as router:
            router.delete(f"{API}/templates/missing").mock(
                return_value=httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
            )
            Template.delete_by_id("missing")  # no exception


class TestInstanceMethods:
    def _make(self, router: respx.MockRouter) -> Template:
        router.post(f"{API}/templates").mock(
            return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
        )
        return Template.create(alias="my-env", from_="python:3.11")

    def test_get_info(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.get_info()
            assert info.status == TemplateStatus.READY

    def test_delete_idempotent_404(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.delete(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
            )
            t.delete()

    def test_rebuild(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            build = {
                "id": "b-2",
                "template_id": "t-1",
                "status": "building",
                "build_spec_hash": "h",
                "created_at": "2026-01-01T00:00:00Z",
            }
            router.post(f"{API}/templates/t-1/builds").mock(
                return_value=httpx.Response(201, json=build)
            )
            b = t.rebuild()
            assert b.id == "b-2"

    def test_list_builds(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.get(f"{API}/templates/t-1/builds", params={"limit": "5"}).mock(
                return_value=httpx.Response(200, json=[])
            )
            t.list_builds(limit=5)

    def test_cancel_build_idempotent(self) -> None:
        with respx.mock() as router:
            t = self._make(router)
            router.delete(f"{API}/templates/t-1/builds/b-1").mock(
                return_value=httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
            )
            t.cancel_build("b-1")
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_template
```
Expected: FAIL — `Template` cannot be imported.

- [ ] **Step 3: Create `template.py`**

Create `packages/python-sdk/src/superserve/template.py`:

```python
"""Sync Template class — reusable sandbox base image with build steps."""

from __future__ import annotations

from typing import Any, Callable

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import api_request, stream_sse
from .errors import BuildError, ConflictError, NotFoundError, SandboxError
from .types import (
    BuildLogEvent,
    BuildStep,
    TemplateBuildInfo,
    TemplateInfo,
    TemplateStatus,
    build_steps_to_api,
    to_build_log_event,
    to_template_build_info,
    to_template_info,
)


class Template:
    """A template — call static factories (`create`, `connect`, `list`)."""

    def __init__(self, info: TemplateInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.alias: str = info.alias
        self.team_id: str = info.team_id
        self.status: TemplateStatus = info.status
        self.vcpu: int = info.vcpu
        self.memory_mib: int = info.memory_mib
        self.disk_mib: int = info.disk_mib
        self.size_bytes: int | None = info.size_bytes
        self.error_message: str | None = info.error_message
        self.created_at = info.created_at
        self.built_at = info.built_at
        self.latest_build_id: str | None = info.latest_build_id
        self._config = config

    # -------------------------------------------------------------------------
    # Static factories
    # -------------------------------------------------------------------------

    @classmethod
    def create(
        cls,
        *,
        alias: str,
        from_: str,
        vcpu: int | None = None,
        memory_mib: int | None = None,
        disk_mib: int | None = None,
        steps: list[BuildStep] | None = None,
        start_cmd: str | None = None,
        ready_cmd: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> "Template":
        config = resolve_config(api_key=api_key, base_url=base_url)

        build_spec: dict[str, Any] = {"from": from_}
        if steps is not None:
            build_spec["steps"] = build_steps_to_api(steps)
        if start_cmd is not None:
            build_spec["start_cmd"] = start_cmd
        if ready_cmd is not None:
            build_spec["ready_cmd"] = ready_cmd

        body: dict[str, Any] = {"alias": alias, "build_spec": build_spec}
        if vcpu is not None:
            body["vcpu"] = vcpu
        if memory_mib is not None:
            body["memory_mib"] = memory_mib
        if disk_mib is not None:
            body["disk_mib"] = disk_mib

        raw = api_request(
            "POST",
            f"{config.base_url}/templates",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        build_id = raw.get("build_id") if raw else None
        if not build_id:
            raise SandboxError(
                "Invalid API response from POST /templates: missing build_id"
            )
        return cls(to_template_info(raw, build_id), config)

    @classmethod
    def connect(
        cls,
        alias_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> "Template":
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/templates/{alias_or_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_template_info(raw), config)

    @classmethod
    def list(
        cls,
        *,
        alias_prefix: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> list[TemplateInfo]:
        from urllib.parse import urlencode

        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/templates"
        if alias_prefix:
            url += "?" + urlencode({"alias_prefix": alias_prefix})
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": config.api_key},
        )
        return [to_template_info(t) for t in raw]

    @classmethod
    def delete_by_id(
        cls,
        alias_or_id: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        config = resolve_config(api_key=api_key, base_url=base_url)
        try:
            api_request(
                "DELETE",
                f"{config.base_url}/templates/{alias_or_id}",
                headers={"X-API-Key": config.api_key},
            )
        except NotFoundError:
            pass

    # -------------------------------------------------------------------------
    # Instance methods
    # -------------------------------------------------------------------------

    def get_info(self) -> TemplateInfo:
        raw = api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_info(raw)

    def delete(self) -> None:
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass

    def rebuild(self) -> TemplateBuildInfo:
        raw = api_request(
            "POST",
            f"{self._config.base_url}/templates/{self.id}/builds",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    def list_builds(self, *, limit: int | None = None) -> list[TemplateBuildInfo]:
        url = f"{self._config.base_url}/templates/{self.id}/builds"
        if limit is not None:
            url += f"?limit={limit}"
        raw = api_request(
            "GET",
            url,
            headers={"X-API-Key": self._config.api_key},
        )
        return [to_template_build_info(b) for b in raw]

    def get_build(self, build_id: str) -> TemplateBuildInfo:
        raw = api_request(
            "GET",
            f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
            headers={"X-API-Key": self._config.api_key},
        )
        return to_template_build_info(raw)

    def cancel_build(self, build_id: str) -> None:
        try:
            api_request(
                "DELETE",
                f"{self._config.base_url}/templates/{self.id}/builds/{build_id}",
                headers={"X-API-Key": self._config.api_key},
            )
        except NotFoundError:
            pass
```

Note: `api_request` returns parsed JSON, or `None` for 204 responses — the DELETE calls above discard the return value, which is fine. Query strings are appended manually because `api_request` doesn't accept a `params` kwarg (same pattern as `Sandbox.list`).

- [ ] **Step 4: Register `Template` in `__init__.py` so the test can import**

Add to `packages/python-sdk/src/superserve/__init__.py`:

```python
from .template import Template
```

And add to `__all__` if the file uses one.

- [ ] **Step 5: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_template
```
Expected: PASS.

- [ ] **Step 6: Lint + typecheck**

```bash
bunx turbo run lint --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/python-sdk/src/superserve/template.py packages/python-sdk/src/superserve/__init__.py packages/python-sdk/tests/test_template.py
git commit -m "python-sdk: add sync Template class"
```

---

### Task 14: Add `stream_build_logs` + `wait_until_ready` to sync `Template`

**Files:**
- Modify: `packages/python-sdk/src/superserve/template.py`
- Test: `packages/python-sdk/tests/test_build_logs.py`

- [ ] **Step 1: Write tests**

Create `packages/python-sdk/tests/test_build_logs.py`:

```python
from __future__ import annotations

import httpx
import pytest
import respx
from superserve import Template
from superserve.errors import BuildError, ConflictError

API = "https://api.example.com"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


BASE = {
    "id": "t-1", "team_id": "team-1", "alias": "my-env", "status": "building",
    "vcpu": 1, "memory_mib": 1024, "disk_mib": 4096,
    "created_at": "2026-01-01T00:00:00Z",
}


def _make_template(router: respx.MockRouter) -> Template:
    router.post(f"{API}/templates").mock(
        return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
    )
    return Template.create(alias="my-env", from_="python:3.11")


def _sse_text(events: list[str]) -> str:
    return "".join(f"data: {e}\n\n" for e in events)


class TestStreamBuildLogs:
    def test_forwards_events(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text([
                '{"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hello"}',
                '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
            ])
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            events: list = []
            t.stream_build_logs(on_event=events.append)
            assert len(events) == 2
            assert events[0].text == "hello"

    def test_raises_when_no_build_id(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = Template.connect("my-env")
            with pytest.raises(Exception, match="build_id required"):
                t.stream_build_logs(on_event=lambda ev: None)


class TestWaitUntilReady:
    def test_resolves_on_ready(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text([
                '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"ok","finished":true,"status":"ready"}',
            ])
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "ready"})
            )
            info = t.wait_until_ready()
            assert info.status.value == "ready"

    def test_raises_build_error_on_failed(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text([
                '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"fail","finished":true,"status":"failed"}',
            ])
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={
                    **BASE, "status": "failed",
                    "error_message": "step_failed: step 1/1 failed",
                })
            )
            with pytest.raises(BuildError) as exc:
                t.wait_until_ready()
            assert exc.value.code == "step_failed"
            assert exc.value.build_id == "b-1"
            assert exc.value.template_id == "t-1"

    def test_raises_conflict_on_cancelled(self) -> None:
        with respx.mock() as router:
            t = _make_template(router)
            sse = _sse_text([
                '{"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"cx","finished":true,"status":"cancelled"}',
            ])
            router.get(f"{API}/templates/t-1/builds/b-1/logs").mock(
                return_value=httpx.Response(200, text=sse)
            )
            router.get(f"{API}/templates/t-1").mock(
                return_value=httpx.Response(200, json={**BASE, "status": "failed"})
            )
            with pytest.raises(ConflictError):
                t.wait_until_ready()
```

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_build_logs
```
Expected: FAIL — methods missing.

- [ ] **Step 3: Implement the methods**

Append inside the `Template` class in `packages/python-sdk/src/superserve/template.py`:

```python
    def stream_build_logs(
        self,
        *,
        on_event: Callable[[BuildLogEvent], None],
        build_id: str | None = None,
    ) -> None:
        bid = build_id or self.latest_build_id
        if not bid:
            raise SandboxError("build_id required: no latest build recorded")

        def on_raw(raw: dict[str, Any]) -> None:
            on_event(to_build_log_event(raw))

        stream_sse(
            f"{self._config.base_url}/templates/{self.id}/builds/{bid}/logs",
            headers={"X-API-Key": self._config.api_key},
            json_body=None,
            method="GET",
            on_event=on_raw,
        )

    def wait_until_ready(
        self,
        *,
        on_log: Callable[[BuildLogEvent], None] | None = None,
        poll_interval_s: float = 2.0,
    ) -> TemplateInfo:
        import re
        import time as _time

        final_status: str | None = None
        bid = self.latest_build_id

        if bid:
            def on_raw(raw: dict[str, Any]) -> None:
                nonlocal final_status
                ev = to_build_log_event(raw)
                if on_log:
                    on_log(ev)
                if ev.finished and ev.status:
                    final_status = ev.status

            try:
                stream_sse(
                    f"{self._config.base_url}/templates/{self.id}/builds/{bid}/logs",
                    headers={"X-API-Key": self._config.api_key},
                    json_body=None,
                    method="GET",
                    on_event=on_raw,
                )
            except Exception:
                # Fall through to polling.
                pass

        while final_status is None:
            info = self.get_info()
            if info.status in (TemplateStatus.READY, TemplateStatus.FAILED):
                final_status = info.status.value
                break
            _time.sleep(poll_interval_s)

        info = self.get_info()
        if final_status == "ready":
            return info
        if final_status == "cancelled":
            raise ConflictError("template build was cancelled", code="cancelled")

        # failed
        msg = info.error_message or "build_failed"
        match = re.match(r"^(\w+):", msg)
        code = match.group(1) if match else "build_failed"
        raise BuildError(msg, code=code, build_id=bid or "", template_id=self.id)
```

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_build_logs
```
Expected: PASS all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/python-sdk/src/superserve/template.py packages/python-sdk/tests/test_build_logs.py
git commit -m "python-sdk: add Template.stream_build_logs and wait_until_ready"
```

---

## Phase 6 — Python SDK `AsyncTemplate`

### Task 15: Create `async_template.py` with full parity

**Files:**
- Create: `packages/python-sdk/src/superserve/async_template.py`
- Test: `packages/python-sdk/tests/test_async_template.py`

- [ ] **Step 1: Read `async_sandbox.py`** to mirror its patterns (how it uses `AsyncClient`, where it manages lifecycle, how it handles callbacks). Don't reinvent.

- [ ] **Step 2: Write tests (parallel structure to `test_template.py`)**

Create `packages/python-sdk/tests/test_async_template.py` — mirror `test_template.py` but:
- Replace `Template.create` → `AsyncTemplate.create`
- Make test methods `async def test_...` with `@pytest.mark.asyncio`
- Use `await` on all SDK calls
- Use `respx.mock()` the same way

Example stub:

```python
from __future__ import annotations

import httpx
import pytest
import respx
from superserve import AsyncTemplate

API = "https://api.example.com"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERSERVE_API_KEY", "ss_live_key")
    monkeypatch.setenv("SUPERSERVE_BASE_URL", API)


BASE = {
    "id": "t-1", "team_id": "team-1", "alias": "my-env", "status": "building",
    "vcpu": 1, "memory_mib": 1024, "disk_mib": 4096,
    "created_at": "2026-01-01T00:00:00Z",
}


class TestAsyncCreate:
    @pytest.mark.asyncio
    async def test_posts(self) -> None:
        with respx.mock() as router:
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={**BASE, "build_id": "b-1"})
            )
            t = await AsyncTemplate.create(alias="my-env", from_="python:3.11")
            assert t.id == "t-1"


class TestAsyncConnect:
    @pytest.mark.asyncio
    async def test_gets(self) -> None:
        with respx.mock() as router:
            router.get(f"{API}/templates/my-env").mock(
                return_value=httpx.Response(200, json=BASE)
            )
            t = await AsyncTemplate.connect("my-env")
            assert t.alias == "my-env"
```

Cover the same scenarios as `test_template.py` (create, connect, list, delete_by_id, instance methods, stream_build_logs, wait_until_ready).

- [ ] **Step 3: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_async_template
```
Expected: FAIL — `AsyncTemplate` not found.

- [ ] **Step 4: Create `async_template.py`**

Create `packages/python-sdk/src/superserve/async_template.py`. Full parity with `template.py` but using `async_api_request` and `async_stream_sse` (there's no separate async-void helper — `async_api_request` returns `None` for 204). Signature example:

```python
"""Async Template class — full parity with sync Template."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

import httpx

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request, async_stream_sse
from .errors import BuildError, ConflictError, NotFoundError, SandboxError
from .types import (
    BuildLogEvent,
    BuildStep,
    TemplateBuildInfo,
    TemplateInfo,
    TemplateStatus,
    build_steps_to_api,
    to_build_log_event,
    to_template_build_info,
    to_template_info,
)


class AsyncTemplate:
    def __init__(self, info: TemplateInfo, config: ResolvedConfig) -> None:
        # identical fields as sync Template
        self.id = info.id
        self.alias = info.alias
        self.team_id = info.team_id
        self.status = info.status
        self.vcpu = info.vcpu
        self.memory_mib = info.memory_mib
        self.disk_mib = info.disk_mib
        self.size_bytes = info.size_bytes
        self.error_message = info.error_message
        self.created_at = info.created_at
        self.built_at = info.built_at
        self.latest_build_id = info.latest_build_id
        self._config = config

    @classmethod
    async def create(cls, *, alias: str, from_: str, ...) -> "AsyncTemplate":
        # identical body to sync, just await the async_api_request
        ...

    # ... full mirror of every sync method, awaited
```

Key differences vs sync:
- All methods `async def` and `await` the helpers
- `wait_until_ready` uses `asyncio.sleep` instead of `time.sleep`
- `on_log` callback may be sync or async — wrap to handle both:

```python
async def _maybe_await(cb: Callable, *args: Any) -> None:
    res = cb(*args)
    if hasattr(res, "__await__"):
        await res
```

- [ ] **Step 5: Export in `__init__.py`**

```python
from .async_template import AsyncTemplate
```

- [ ] **Step 6: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_async_template
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/python-sdk/src/superserve/async_template.py packages/python-sdk/src/superserve/__init__.py packages/python-sdk/tests/test_async_template.py
git commit -m "python-sdk: add AsyncTemplate class"
```

---

## Phase 7 — Python SDK Sandbox integration + exports + e2e

### Task 16: Extend `Sandbox.create` / `AsyncSandbox.create` with `from_template` / `from_snapshot`

**Files:**
- Modify: `packages/python-sdk/src/superserve/sandbox.py`
- Modify: `packages/python-sdk/src/superserve/async_sandbox.py`
- Test: `packages/python-sdk/tests/test_sandbox.py` + `test_async.py`

- [ ] **Step 1: Write failing tests**

Append to `packages/python-sdk/tests/test_sandbox.py`:

```python
class TestCreateFromTemplate:
    def test_maps_string(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            Sandbox.create(name="b", from_template="superserve/python-3.11")
            assert b'"from_template": "superserve/python-3.11"' in route.calls.last.request.content

    def test_maps_instance(self) -> None:
        with respx.mock() as router:
            # First: mock template create
            router.post(f"{API}/templates").mock(
                return_value=httpx.Response(202, json={
                    "id": "t-1", "team_id": "team-1", "alias": "my-env",
                    "status": "building", "vcpu": 1, "memory_mib": 1024, "disk_mib": 4096,
                    "created_at": "2026-01-01T00:00:00Z", "build_id": "b-1",
                })
            )
            tpl = Template.create(alias="my-env", from_="python:3.11")
            # Then: sandbox create with instance
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            Sandbox.create(name="b", from_template=tpl)
            assert b'"from_template": "my-env"' in route.calls.last.request.content

    def test_maps_from_snapshot(self) -> None:
        with respx.mock() as router:
            route = router.post(f"{API}/sandboxes").mock(
                return_value=httpx.Response(200, json=_raw())
            )
            Sandbox.create(name="b", from_snapshot="snap-abc")
            assert b'"from_snapshot": "snap-abc"' in route.calls.last.request.content
```

Remember to import `Template` at the top of the file.

- [ ] **Step 2: Confirm failure**

```bash
bunx turbo run test --filter=@superserve/python-sdk -- test_sandbox
```
Expected: FAIL — kwargs unknown.

- [ ] **Step 3: Extend `Sandbox.create`**

In `packages/python-sdk/src/superserve/sandbox.py`, modify `create` signature and body:

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
) -> "Sandbox":
    config = resolve_config(api_key=api_key, base_url=base_url)

    body: dict[str, Any] = {"name": name}

    if from_template is not None:
        if isinstance(from_template, str):
            body["from_template"] = from_template
        else:
            body["from_template"] = getattr(from_template, "alias", None) or from_template.id

    if from_snapshot is not None:
        body["from_snapshot"] = from_snapshot

    # ... existing body construction (timeout_seconds, metadata, etc.) unchanged
```

Add the `Template` import at the top of `sandbox.py`:

```python
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .template import Template  # avoid circular at runtime
```

Repeat in `async_sandbox.py` with `AsyncTemplate`.

- [ ] **Step 4: Confirm tests pass**

```bash
bunx turbo run test --filter=@superserve/python-sdk
```
Expected: PASS all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/python-sdk/src/superserve/sandbox.py packages/python-sdk/src/superserve/async_sandbox.py packages/python-sdk/tests/test_sandbox.py packages/python-sdk/tests/test_async.py
git commit -m "python-sdk: Sandbox.create accepts from_template and from_snapshot"
```

---

### Task 17: Finalize `__init__.py` exports

**Files:**
- Modify: `packages/python-sdk/src/superserve/__init__.py`

- [ ] **Step 1: Update exports**

Replace `packages/python-sdk/src/superserve/__init__.py` with:

```python
"""Superserve SDK — sandbox infrastructure for running code in isolated cloud environments."""

from .async_sandbox import AsyncSandbox
from .async_template import AsyncTemplate
from .errors import (
    AuthenticationError,
    BuildError,
    ConflictError,
    NotFoundError,
    SandboxError,
    SandboxTimeoutError,
    ServerError,
    ValidationError,
)
from .sandbox import Sandbox
from .template import Template
from .types import (
    BuildLogEvent,
    BuildLogStream,
    BuildStep,
    CommandResult,
    EnvStep,
    EnvStepValue,
    NetworkConfig,
    RunStep,
    SandboxInfo,
    SandboxStatus,
    TemplateBuildInfo,
    TemplateBuildStatus,
    TemplateInfo,
    TemplateStatus,
    UserStep,
    UserStepValue,
    WorkdirStep,
)

__version__ = "0.6.0"  # bump if shipping a release; otherwise keep current

__all__ = [
    "AsyncSandbox",
    "AsyncTemplate",
    "AuthenticationError",
    "BuildError",
    "BuildLogEvent",
    "BuildLogStream",
    "BuildStep",
    "CommandResult",
    "ConflictError",
    "EnvStep",
    "EnvStepValue",
    "NetworkConfig",
    "NotFoundError",
    "RunStep",
    "Sandbox",
    "SandboxError",
    "SandboxInfo",
    "SandboxStatus",
    "SandboxTimeoutError",
    "ServerError",
    "Template",
    "TemplateBuildInfo",
    "TemplateBuildStatus",
    "TemplateInfo",
    "TemplateStatus",
    "UserStep",
    "UserStepValue",
    "ValidationError",
    "WorkdirStep",
]
```

- [ ] **Step 2: Verify imports work**

```bash
cd /Users/nirnejak/conductor/workspaces/superserve/columbia
uv run python -c "from superserve import Template, AsyncTemplate, BuildError, RunStep; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Full test run**

```bash
bunx turbo run test --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/python-sdk/src/superserve/__init__.py
git commit -m "python-sdk: export Template, AsyncTemplate, BuildError, and new types"
```

---

### Task 18: Python SDK end-to-end test

**Files:**
- Create: `tests/sdk-e2e-py/test_templates.py`

- [ ] **Step 1: Write the e2e test**

Create `tests/sdk-e2e-py/test_templates.py`:

```python
from __future__ import annotations

import os
import time
import uuid
from typing import Optional

import pytest
from superserve import Sandbox, Template
from superserve.errors import BuildError

API_KEY: Optional[str] = os.environ.get("SUPERSERVE_API_KEY")
BASE_URL: str = os.environ.get("SUPERSERVE_BASE_URL", "https://api-staging.superserve.ai")

skip_if_no_key = pytest.mark.skipif(
    API_KEY is None, reason="SUPERSERVE_API_KEY not set"
)


@skip_if_no_key
def test_list_includes_system_templates() -> None:
    templates = Template.list(api_key=API_KEY, base_url=BASE_URL)
    assert any(t.alias.startswith("superserve/") for t in templates)


@skip_if_no_key
def test_create_build_launch_cleanup() -> None:
    alias = f"e2e-tpl-{uuid.uuid4().hex[:8]}"
    template = Template.create(
        api_key=API_KEY, base_url=BASE_URL,
        alias=alias,
        from_="python:3.11",
        steps=[{"run": "echo hello > /tmp/marker"}],  # dict also accepted via Pydantic
    )
    try:
        template.wait_until_ready(
            on_log=lambda ev: print(ev.text, end="") if ev.stream in ("stdout", "stderr") else None,
        )
        fresh = template.get_info()
        assert fresh.status.value == "ready"

        sandbox = Sandbox.create(
            api_key=API_KEY, base_url=BASE_URL,
            name=f"e2e-sbx-{uuid.uuid4().hex[:8]}",
            from_template=template,
        )
        try:
            result = sandbox.commands.run("cat /tmp/marker")
            assert result.stdout.strip() == "hello"
        finally:
            sandbox.kill()
    finally:
        template.delete()
```

Note: if the Pydantic step union doesn't auto-parse dicts, use the typed classes: `[RunStep(run="echo ...")]`. Check at implementation time.

- [ ] **Step 2: Run (optional)**

```bash
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/test-sdk-e2e-py
```

- [ ] **Step 3: Commit**

```bash
git add tests/sdk-e2e-py/test_templates.py
git commit -m "sdk-e2e: add python templates end-to-end test"
```

---

## Phase 8 — Mintlify docs

### Task 19: Create `docs/templates/overview.mdx`

**Files:**
- Create: `docs/templates/overview.mdx`

- [ ] **Step 1: Read an existing page to match style**

Read `docs/sandbox/lifecycle.mdx` and `docs/sandbox/create.mdx` to match the Mintlify frontmatter, heading cadence, and `<CodeGroup>` usage.

- [ ] **Step 2: Write the page**

Create `docs/templates/overview.mdx`:

```mdx
---
title: "Templates"
description: "Reusable base images with build steps that sandboxes boot from"
---

A **template** is a snapshot of a Linux filesystem — base image, build steps, and optionally a long-running process — that sandboxes boot from. Templates let you pre-install dependencies once and launch identically configured sandboxes in seconds.

Every sandbox is created from a template. If you don't specify one, Superserve defaults to `superserve/base`.

## System templates

Curated by Superserve, available to every team. Identified by the `superserve/` alias prefix.

| Alias | Base | Notes |
|---|---|---|
| `superserve/base` | Ubuntu 24.04 | Python 3.12, Node.js 22, git, curl, build-essential. Default when `fromTemplate` is omitted. |
| `superserve/python-3.11` | Python 3.11 | Python-focused image with common scientific libraries. |
| `superserve/node-22` | Node.js 22 | Node-focused image with bun + npm. |

## Team templates

Team-owned templates let you bake in team-specific dependencies (e.g. `my-python-env` with scientific libs pre-installed). They're created via `Template.create()` and referenced by alias.

Team template aliases **cannot** start with `superserve/` — that prefix is reserved.

## Aliases vs UUIDs

Both SDKs and the API accept **either** the template's alias (`my-python-env`) or its UUID. Aliases are more readable; UUIDs are stable if an alias gets renamed or deleted.

## Related

- [Create a template](/templates/create)
- [Template lifecycle: rebuild, cancel, delete](/templates/lifecycle)
- [BuildSpec reference](/templates/build-spec)
- [SDK reference: Template](/sdk-reference/template)
```

- [ ] **Step 3: Render locally (optional)**

```bash
bun run docs:dev
```
Open `http://localhost:3000/templates/overview` and verify rendering.

- [ ] **Step 4: Commit**

```bash
git add docs/templates/overview.mdx
git commit -m "docs: add templates overview page"
```

---

### Task 20: Create `docs/templates/create.mdx`

**Files:**
- Create: `docs/templates/create.mdx`

- [ ] **Step 1: Write the page**

Create `docs/templates/create.mdx`:

```mdx
---
title: "Create a template"
description: "Build your first team template, stream logs, launch a sandbox from it"
---

Build a reusable sandbox environment in three steps: define the template, wait for the build to finish, then create sandboxes from it.

## Create the template

Pass a base image via `from` and (optionally) a list of build steps that run inside the build VM.

<CodeGroup>

```typescript TypeScript
import { Template } from "@superserve/sdk"

const template = await Template.create({
  alias: "my-python-env",
  vcpu: 2,
  memoryMib: 2048,
  from: "python:3.11",
  steps: [
    { run: "pip install numpy pandas" },
    { env: { key: "DEBUG", value: "1" } },
    { workdir: "/app" },
  ],
})
```

```python Python
from superserve import Template
from superserve.types import RunStep, EnvStep, EnvStepValue, WorkdirStep

template = Template.create(
    alias="my-python-env",
    vcpu=2,
    memory_mib=2048,
    from_="python:3.11",
    steps=[
        RunStep(run="pip install numpy pandas"),
        EnvStep(env=EnvStepValue(key="DEBUG", value="1")),
        WorkdirStep(workdir="/app"),
    ],
)
```

</CodeGroup>

`Template.create` returns once the template is registered and the first build is queued — **not** when the build is finished. Call `waitUntilReady()` (TS) / `wait_until_ready()` (Python) to block until the build reaches a terminal state.

## Stream build logs

`waitUntilReady` accepts an `onLog` callback that receives each SSE event as the build runs.

<CodeGroup>

```typescript TypeScript
await template.waitUntilReady({
  onLog: (event) => {
    if (event.stream === "system") return  // skip supervisor metadata
    process.stdout.write(event.text)
  },
})
```

```python Python
def print_log(ev):
    if ev.stream != "system":
        print(ev.text, end="")

template.wait_until_ready(on_log=print_log)
```

</CodeGroup>

On success, `waitUntilReady` returns the refreshed `TemplateInfo` with `status = "ready"`. On failure, it raises `BuildError` with a machine-readable `code` (e.g. `step_failed`, `image_pull_failed`).

## Create a sandbox from the template

Once ready, create sandboxes with either the template alias or the instance.

<CodeGroup>

```typescript TypeScript
import { Sandbox } from "@superserve/sdk"

// Option 1: pass the Template instance
const sandbox = await Sandbox.create({
  name: "run-1",
  fromTemplate: template,
})

// Option 2: pass the alias
const sandbox2 = await Sandbox.create({
  name: "run-2",
  fromTemplate: "my-python-env",
})
```

```python Python
from superserve import Sandbox

# Option 1: pass the Template instance
sandbox = Sandbox.create(name="run-1", from_template=template)

# Option 2: pass the alias
sandbox2 = Sandbox.create(name="run-2", from_template="my-python-env")
```

</CodeGroup>

The sandbox's vCPU, memory, and disk size are inherited from the template — they cannot be overridden at sandbox creation (the snapshot dictates VM shape).

## Related

- [Templates overview](/templates/overview)
- [Rebuild, cancel, delete](/templates/lifecycle)
- [BuildSpec reference](/templates/build-spec)
- [SDK reference: Template](/sdk-reference/template)
```

- [ ] **Step 2: Commit**

```bash
git add docs/templates/create.mdx
git commit -m "docs: add templates/create.mdx guide"
```

---

### Task 21: Create `docs/templates/lifecycle.mdx`

**Files:**
- Create: `docs/templates/lifecycle.mdx`

- [ ] **Step 1: Write the page**

Create `docs/templates/lifecycle.mdx`:

```mdx
---
title: "Rebuild, cancel, delete"
description: "Manage a template over time: trigger new builds, cancel in-flight ones, delete stale templates"
---

## Rebuild

Queue a new build for an existing template — e.g. after a failed build, or to pick up an updated base image.

<CodeGroup>

```typescript TypeScript
const build = await template.rebuild()
console.log(`Build queued: ${build.id}`)
```

```python Python
build = template.rebuild()
print(f"Build queued: {build.id}")
```

</CodeGroup>

Rebuild is **idempotent on spec hash**: if an in-flight build already exists for this template with the same `build_spec_hash`, the API returns the existing build's id with `200` instead of creating a duplicate.

## List and inspect builds

<CodeGroup>

```typescript TypeScript
const builds = await template.listBuilds({ limit: 10 })
for (const b of builds) {
  console.log(b.id, b.status, b.errorMessage ?? "")
}

const build = await template.getBuild(builds[0].id)
```

```python Python
builds = template.list_builds(limit=10)
for b in builds:
    print(b.id, b.status, b.error_message or "")

build = template.get_build(builds[0].id)
```

</CodeGroup>

## Cancel an in-flight build

<CodeGroup>

```typescript TypeScript
await template.cancelBuild(build.id)
```

```python Python
template.cancel_build(build.id)
```

</CodeGroup>

`cancelBuild` is a no-op for builds already in a terminal state.

## Delete a template

<CodeGroup>

```typescript TypeScript
await template.delete()

// Or by id / alias
await Template.deleteById("my-python-env")
```

```python Python
template.delete()

# Or by id / alias
Template.delete_by_id("my-python-env")
```

</CodeGroup>

Both calls are idempotent on `404`. If any non-destroyed sandbox still references the template, the call raises `ConflictError` — destroy those sandboxes first.

## Related

- [Create a template](/templates/create)
- [BuildSpec reference](/templates/build-spec)
- [SDK reference: Template](/sdk-reference/template)
```

- [ ] **Step 2: Commit**

```bash
git add docs/templates/lifecycle.mdx
git commit -m "docs: add templates/lifecycle.mdx guide"
```

---

### Task 22: Create `docs/templates/build-spec.mdx`

**Files:**
- Create: `docs/templates/build-spec.mdx`

- [ ] **Step 1: Write the page**

Create `docs/templates/build-spec.mdx`:

```mdx
---
title: "BuildSpec reference"
description: "How to describe a template's base image, build steps, and runtime defaults"
---

A `BuildSpec` is the canonical declaration of how to build a template. The SDK flattens it onto `TemplateCreateOptions` for convenience — `from` / `steps` / `startCmd` / `readyCmd` are top-level options.

## `from` — base image

An OCI image reference. Resolved to a digest at build time for reproducibility.

```typescript
from: "python:3.11"           // Docker Hub
from: "ghcr.io/myorg/foo:v1"  // any OCI registry
```

**Constraints:**
- Must be a **linux/amd64** image
- **Alpine and distroless bases are rejected** at validation time (musl/busybox incompat with build tooling)

## `steps` — ordered build steps

A list of tagged objects executed in order inside the build VM. Exactly one of `run` / `env` / `workdir` / `user` must be set per step.

### `run` — shell command

```typescript
{ run: "pip install -r requirements.txt" }
```

Wrapped in `/bin/sh -c` inside the build VM.

### `env` — environment variable

```typescript
{ env: { key: "DEBUG", value: "1" } }
```

Sets an env var for subsequent build steps AND as a runtime default. Caller-supplied `envVars` on sandbox create override on conflict.

### `workdir` — working directory

```typescript
{ workdir: "/srv/app" }
```

Working directory for subsequent build steps and the runtime default cwd. Auto-created and chowned to the current build user. Per-exec `workingDir` overrides at runtime.

### `user` — switch user

```typescript
{ user: { name: "appuser", sudo: true } }
```

Switches the user for subsequent build steps and sets the runtime default exec user. User is created if not present. `sudo: true` grants passwordless sudo.

## `startCmd` — process to start after build

```typescript
startCmd: "python server.py"
```

The snapshot captures the running process, so sandboxes restored from this template come up with it already live.

## `readyCmd` — readiness probe

```typescript
readyCmd: "curl -f http://localhost:8080/health"
```

Polled every 2s after `startCmd` until it exits `0` or 10 minutes elapse. Use this to wait for a server to bind its port before snapshotting.

## Resource limits

Templates specify the VM shape — sandboxes inherit these and cannot override them per-sandbox.

| Field | Min | Max | Default |
|---|---|---|---|
| `vcpu` | 1 | 4 | 1 |
| `memoryMib` | 256 | 4096 | 1024 |
| `diskMib` | 1024 | 8192 | 4096 |

## Build error codes

On failure, `BuildError.code` is one of these stable identifiers (parsed from `errorMessage`):

| Code | Meaning |
|---|---|
| `image_pull_failed` | Base image couldn't be pulled or resolved |
| `step_failed` | A build step exited non-zero |
| `boot_failed` | Build VM failed to boot |
| `snapshot_failed` | Snapshot bundle couldn't be produced |
| `start_cmd_failed` | `startCmd` exited non-zero before snapshot |
| `ready_cmd_failed` | `readyCmd` didn't exit `0` within 10 minutes |
| `too_many_builds` | Team's concurrent build limit reached |
| `build_failed` | Catch-all when no specific code applies |

## Related

- [Create a template](/templates/create)
- [Errors](/errors)
```

- [ ] **Step 2: Commit**

```bash
git add docs/templates/build-spec.mdx
git commit -m "docs: add templates/build-spec.mdx reference"
```

---

### Task 23: Create `docs/sdk-reference/template.mdx`

**Files:**
- Create: `docs/sdk-reference/template.mdx`

- [ ] **Step 1: Read `docs/sdk-reference/sandbox.mdx`** — match the per-class reference pattern: import block, static methods section, instance methods section, types subsection.

- [ ] **Step 2: Write the page**

Create `docs/sdk-reference/template.mdx` with the same skeleton as `sandbox.mdx`. Enumerate:
- `Template.create`, `Template.connect`, `Template.list`, `Template.deleteById`
- `template.getInfo`, `template.waitUntilReady`, `template.streamBuildLogs`, `template.rebuild`, `template.listBuilds`, `template.getBuild`, `template.cancelBuild`, `template.delete`
- `TemplateInfo`, `TemplateBuildInfo`, `BuildLogEvent`, `BuildStep`, `TemplateStatus`, `TemplateBuildStatus`, `BuildLogStream`
- `BuildError` (cross-link to `/errors`)

Each method/type has a `<CodeGroup>` example. Keep the file ~200–300 lines.

- [ ] **Step 3: Commit**

```bash
git add docs/sdk-reference/template.mdx
git commit -m "docs: add Template SDK reference"
```

---

### Task 24: Update existing pages + navigation

**Files:**
- Modify: `docs/sandbox/create.mdx`
- Modify: `docs/sdk-reference/sandbox.mdx`
- Modify: `docs/errors.mdx`
- Modify: `docs/docs.json`

- [ ] **Step 1: Add "Create from a template" subsection to `docs/sandbox/create.mdx`**

Append before the closing "Related" section:

```mdx
## Create from a template

Boot a sandbox from a system or team template via `fromTemplate` (alias, UUID, or `Template` instance).

<CodeGroup>

```typescript TypeScript
const sandbox = await Sandbox.create({
  name: "my-sandbox",
  fromTemplate: "superserve/python-3.11",  // alias
})
```

```python Python
sandbox = Sandbox.create(
    name="my-sandbox",
    from_template="superserve/python-3.11",
)
```

</CodeGroup>

The sandbox's vCPU, memory, and disk size are inherited from the template — they cannot be overridden. See [Templates overview](/templates/overview) for how to build your own.
```

- [ ] **Step 2: Add `fromTemplate` / `fromSnapshot` to `docs/sdk-reference/sandbox.mdx`**

Find the `SandboxCreateOptions` table in `docs/sdk-reference/sandbox.mdx` and add rows:

```md
| `fromTemplate` | `string \| Template` | Template alias, UUID, or `Template` instance. Defaults to `superserve/base`. |
| `fromSnapshot` | `string` | Snapshot UUID to boot from. |
```

Same for the Python section (`from_template` / `from_snapshot`).

- [ ] **Step 3: Add `BuildError` to `docs/errors.mdx`**

Append before the final "Related" section:

```mdx
## `BuildError`

Raised by `Template.waitUntilReady()` / `wait_until_ready()` when the awaited build lands on status `failed`.

**Fields:**
- `code` — stable error prefix (`image_pull_failed`, `step_failed`, `boot_failed`, `snapshot_failed`, `start_cmd_failed`, `ready_cmd_failed`, `build_failed`)
- `buildId` — the build that failed
- `templateId` — the template id
- `message` — the original `error_message` from the API

See [BuildSpec reference: build error codes](/templates/build-spec#build-error-codes) for a full list of codes and their meanings.
```

- [ ] **Step 4: Update `docs/docs.json`**

Read the current `docs.json` and locate the `navigation` / `tabs` / `groups` structure. Add a new group entry **between "Sandbox" and "Commands"**:

```json
{
  "group": "Templates",
  "pages": [
    "templates/overview",
    "templates/create",
    "templates/lifecycle",
    "templates/build-spec"
  ]
}
```

Add `sdk-reference/template` to the `SDK Reference` group's `pages` array.

- [ ] **Step 5: Render locally**

```bash
bun run docs:dev
```
Navigate to each new page and verify:
- `/templates/overview`, `/templates/create`, `/templates/lifecycle`, `/templates/build-spec` render
- `/sdk-reference/template` renders
- Nav shows the "Templates" group in the correct position
- `/sandbox/create` shows the new "Create from a template" subsection
- `/errors` lists `BuildError`

- [ ] **Step 6: Validate build**

```bash
bun run docs:build
```
Expected: builds cleanly, no broken-link warnings on templates pages.

- [ ] **Step 7: Commit**

```bash
git add docs/sandbox/create.mdx docs/sdk-reference/sandbox.mdx docs/errors.mdx docs/docs.json
git commit -m "docs: document fromTemplate + BuildError and wire templates nav"
```

---

## Final verification

- [ ] **Step 1: Full repo typecheck + lint + test**

```bash
bun run typecheck
bun run lint
bun run test
bun run docs:build
```
Expected: all green.

- [ ] **Step 2: Build artifacts**

```bash
bunx turbo run build --filter=@superserve/sdk
bunx turbo run build --filter=@superserve/python-sdk
```
Expected: TS builds `dist/`, Python builds `.venv`-accessible package.

- [ ] **Step 3: Optional — run e2e against staging**

```bash
SUPERSERVE_API_KEY=ss_live_... bun run test:e2e
```
Expected: both TS and Python e2e green.

- [ ] **Step 4: Final confirmation**

Acceptance checks from the design spec:

1. `Template.create` / `Template.connect` / `Template.list` / `Template.deleteById` work against staging — **verify via Task 9 / Task 18 e2e runs**
2. `Sandbox.create({ fromTemplate: "superserve/python-3.11" })` boots a sandbox — **verify e2e**
3. `Sandbox.create({ fromTemplate: templateInstance })` works after `await template.waitUntilReady()` — **verify e2e**
4. `waitUntilReady({ onLog })` streams events and resolves; throws `BuildError` on `failed` with parsed `.code` — **Task 6 + Task 14 unit tests cover**
5. `rebuild()` idempotent on spec hash — covered by API spec; unit tests verify the call is made
6. Docs pages render without Mintlify errors — **Task 24 Step 5-6**
7. `bun run typecheck` clean; `mypy` clean — **Step 1 above**
8. Unit + e2e tests pass in CI — **Step 1 and 3 above**
