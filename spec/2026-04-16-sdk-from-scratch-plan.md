# SDK From Scratch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fern-generated TypeScript and Python SDKs with hand-crafted, E2B-style SDKs; remove all Fern infrastructure; restore Mintlify docs.

**Architecture:** Single `Sandbox` class with static factory methods and sub-module properties (`.commands`, `.files`). SDK internally handles control-plane / data-plane split. Zero external runtime dependencies for TypeScript (native `fetch`); `httpx` + `pydantic` for Python.

**Tech Stack:** TypeScript (tsup, ESM+CJS), Python 3.9+ (httpx, pydantic), Mintlify (docs), Vitest (TS tests), pytest (Python tests).

---

## File Map

### TypeScript SDK — Create:
- `packages/sdk/src/index.ts` — public exports
- `packages/sdk/src/Sandbox.ts` — main Sandbox class
- `packages/sdk/src/commands.ts` — Commands sub-module
- `packages/sdk/src/files.ts` — Files sub-module
- `packages/sdk/src/http.ts` — HTTP client (fetch-based)
- `packages/sdk/src/config.ts` — ConnectionConfig, URL construction
- `packages/sdk/src/errors.ts` — typed error hierarchy
- `packages/sdk/src/types.ts` — all interfaces/types
- `packages/sdk/src/polling.ts` — waitForStatus utility

### TypeScript SDK — Delete:
- `packages/sdk/src/api/` (entire directory)
- `packages/sdk/src/core/` (entire directory)
- `packages/sdk/src/auth/` (entire directory)
- `packages/sdk/src/errors/` (entire directory)
- `packages/sdk/src/Client.ts`
- `packages/sdk/src/BaseClient.ts`
- `packages/sdk/src/environments.ts`
- `packages/sdk/src/exports.ts`
- `packages/sdk/src/index.ts` (rewritten)
- `packages/sdk/.fernignore`

### Python SDK — Create:
- `packages/python-sdk/src/superserve/__init__.py` — public exports
- `packages/python-sdk/src/superserve/sandbox.py` — Sandbox (sync)
- `packages/python-sdk/src/superserve/async_sandbox.py` — AsyncSandbox
- `packages/python-sdk/src/superserve/commands.py` — Commands + AsyncCommands
- `packages/python-sdk/src/superserve/files.py` — Files + AsyncFiles
- `packages/python-sdk/src/superserve/_http.py` — httpx client wrapper
- `packages/python-sdk/src/superserve/_config.py` — ConnectionConfig
- `packages/python-sdk/src/superserve/errors.py` — error hierarchy
- `packages/python-sdk/src/superserve/types.py` — Pydantic models
- `packages/python-sdk/src/superserve/_polling.py` — wait_for_status

### Python SDK — Delete:
- `packages/python-sdk/src/superserve/` (entire directory, then recreated)

### Fern — Delete:
- `fern/` (entire directory)
- `.github/workflows/fern-generate.yml`
- `.github/workflows/docs.yml`

### Fern — Modify:
- Root `package.json` — remove fern scripts + devDependency
- `turbo.json` — remove `generate` task
- `.gitignore` — remove `fern/openapi.yaml` line

### Docs — Create:
- `docs/docs.json` — Mintlify config (restored + updated)
- `docs/introduction.mdx`
- `docs/quickstart.mdx`
- Various SDK reference and concept pages

### E2E Tests — Modify:
- `tests/sdk-e2e-ts/src/client.ts` — use new Sandbox API
- `tests/sdk-e2e-ts/src/polling.ts` — use new SDK types
- `tests/sdk-e2e-ts/tests/*.test.ts` — update to new API
- `tests/sdk-e2e-py/conftest.py` — use new Sandbox class
- `tests/sdk-e2e-py/test_*.py` — update to new API

---

## Task 1: Remove Fern Infrastructure

**Files:**
- Delete: `fern/` (entire directory)
- Delete: `.github/workflows/fern-generate.yml`
- Delete: `.github/workflows/docs.yml`
- Modify: `package.json` (root)
- Modify: `turbo.json`
- Modify: `.gitignore`

- [ ] **Step 1: Delete the `fern/` directory**

```bash
rm -rf fern/
```

- [ ] **Step 2: Delete Fern GitHub Actions workflows**

```bash
rm .github/workflows/fern-generate.yml
rm .github/workflows/docs.yml
```

- [ ] **Step 3: Remove Fern scripts and devDependency from root `package.json`**

Remove these lines from `package.json`:
- `"generate:sync"` script
- `"generate"` script
- `"generate:check"` script
- `"docs:dev"` script
- `"docs:publish"` script
- `"fern-api": "^4.64.0"` from `devDependencies`

The `scripts` section should become:

```json
"scripts": {
  "build": "turbo run build",
  "dev": "turbo run dev",
  "lint": "turbo run lint",
  "typecheck": "turbo run typecheck",
  "test": "turbo run test",
  "test:coverage": "turbo run test:coverage",
  "test:e2e": "turbo run e2e",
  "prepare": "husky"
},
```

The `devDependencies` should become:

```json
"devDependencies": {
  "husky": "^9.1.7",
  "lint-staged": "^16.4.0",
  "turbo": "^2.9.4"
},
```

- [ ] **Step 4: Remove `generate` task from `turbo.json`**

Remove this entire block from the `"tasks"` object in `turbo.json`:

```json
"generate": {
  "inputs": ["fern/**"],
  "outputs": [
    "packages/sdk/src/**",
    "packages/python-sdk/src/superserve/**"
  ],
  "cache": false
},
```

- [ ] **Step 5: Remove Fern `.gitignore` entry**

Remove these lines from `.gitignore`:

```
# Fern — openapi spec is fetched on demand from the backend repo, never committed
fern/openapi.yaml
```

- [ ] **Step 6: Verify cleanup**

Run: `grep -r "fern" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.ts" --include="*.py" . | grep -v node_modules | grep -v .git/`

Expected: No remaining Fern references (aside from `.fernignore` files in SDK packages, which will be removed in Tasks 2-3).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "remove fern infrastructure"
```

---

## Task 2: Delete Generated TypeScript SDK Code

**Files:**
- Delete: `packages/sdk/src/api/`, `packages/sdk/src/core/`, `packages/sdk/src/auth/`, `packages/sdk/src/errors/`
- Delete: `packages/sdk/src/Client.ts`, `packages/sdk/src/BaseClient.ts`, `packages/sdk/src/environments.ts`, `packages/sdk/src/exports.ts`, `packages/sdk/src/index.ts`
- Delete: `packages/sdk/.fernignore`

- [ ] **Step 1: Delete all generated source files**

```bash
rm -rf packages/sdk/src/api packages/sdk/src/core packages/sdk/src/auth packages/sdk/src/errors
rm -f packages/sdk/src/Client.ts packages/sdk/src/BaseClient.ts packages/sdk/src/environments.ts packages/sdk/src/exports.ts packages/sdk/src/index.ts
rm -f packages/sdk/.fernignore
```

- [ ] **Step 2: Verify only config files remain**

```bash
ls packages/sdk/src/
```

Expected: Empty directory (or non-existent `src/`).

```bash
ls packages/sdk/
```

Expected: `package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`, `node_modules/`, `dist/`, `.turbo/`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "delete generated typescript sdk code"
```

---

## Task 3: Delete Generated Python SDK Code

**Files:**
- Delete: `packages/python-sdk/src/superserve/` (entire directory)
- Delete: `packages/python-sdk/.fernignore`

- [ ] **Step 1: Delete all generated Python source files**

```bash
rm -rf packages/python-sdk/src/superserve/
rm -f packages/python-sdk/.fernignore
```

- [ ] **Step 2: Recreate empty package directory**

```bash
mkdir -p packages/python-sdk/src/superserve
```

- [ ] **Step 3: Verify only config files remain**

```bash
ls packages/python-sdk/
```

Expected: `pyproject.toml`, `README.md`, `package.json`, `src/`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "delete generated python sdk code"
```

---

## Task 4: TypeScript SDK — Types and Errors

**Files:**
- Create: `packages/sdk/src/types.ts`
- Create: `packages/sdk/src/errors.ts`

- [ ] **Step 1: Create `packages/sdk/src/types.ts`**

```typescript
/**
 * Core types for the Superserve SDK.
 *
 * These mirror the API response shapes with camelCase field names.
 * The SDK converts snake_case API responses to these types internally.
 */

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export type SandboxStatus = "starting" | "active" | "pausing" | "idle" | "deleted"

export interface NetworkConfig {
  allowOut?: string[]
  denyOut?: string[]
}

export interface SandboxInfo {
  id: string
  name: string
  status: SandboxStatus
  vcpuCount: number
  memoryMib: number
  accessToken: string
  snapshotId?: string
  createdAt: Date
  timeoutSeconds?: number
  network?: NetworkConfig
  metadata: Record<string, string>
}

// ---------------------------------------------------------------------------
// Sandbox Options
// ---------------------------------------------------------------------------

export interface ConnectionOptions {
  apiKey?: string
  baseUrl?: string
}

export interface SandboxCreateOptions extends ConnectionOptions {
  name: string
  fromSnapshot?: string
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  network?: NetworkConfig
}

export interface SandboxListOptions extends ConnectionOptions {
  metadata?: Record<string, string>
}

export interface SandboxUpdateOptions {
  metadata?: Record<string, string>
  network?: NetworkConfig
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type FileInput = string | Buffer | Uint8Array | Blob | ArrayBuffer

// ---------------------------------------------------------------------------
// Internal: API response shapes (snake_case, as returned by the API)
// ---------------------------------------------------------------------------

/** @internal */
export interface ApiSandboxResponse {
  id?: string
  name?: string
  status?: string
  vcpu_count?: number
  memory_mib?: number
  access_token?: string
  snapshot_id?: string
  created_at?: string
  timeout_seconds?: number
  network?: { allow_out?: string[]; deny_out?: string[] }
  metadata?: Record<string, string>
}

/** @internal */
export interface ApiExecResult {
  stdout?: string
  stderr?: string
  exit_code?: number
}

/** @internal */
export interface ApiExecStreamEvent {
  timestamp?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  finished?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @internal Convert an API sandbox response to a SandboxInfo. */
export function toSandboxInfo(raw: ApiSandboxResponse): SandboxInfo {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    status: (raw.status ?? "starting") as SandboxStatus,
    vcpuCount: raw.vcpu_count ?? 0,
    memoryMib: raw.memory_mib ?? 0,
    accessToken: raw.access_token ?? "",
    snapshotId: raw.snapshot_id ?? undefined,
    createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
    timeoutSeconds: raw.timeout_seconds ?? undefined,
    network: raw.network
      ? { allowOut: raw.network.allow_out, denyOut: raw.network.deny_out }
      : undefined,
    metadata: raw.metadata ?? {},
  }
}
```

- [ ] **Step 2: Create `packages/sdk/src/errors.ts`**

```typescript
/**
 * Typed error hierarchy for the Superserve SDK.
 *
 * Maps HTTP status codes to specific error classes so users can catch
 * granular errors without inspecting status codes.
 */

export class SandboxError extends Error {
  readonly statusCode?: number
  readonly code?: string

  constructor(message: string, statusCode?: number, code?: string) {
    super(message)
    this.name = "SandboxError"
    this.statusCode = statusCode
    this.code = code
  }
}

export class AuthenticationError extends SandboxError {
  constructor(message = "Missing or invalid API key") {
    super(message, 401)
    this.name = "AuthenticationError"
  }
}

export class ValidationError extends SandboxError {
  constructor(message: string) {
    super(message, 400)
    this.name = "ValidationError"
  }
}

export class NotFoundError extends SandboxError {
  constructor(message = "Resource not found") {
    super(message, 404)
    this.name = "NotFoundError"
  }
}

export class ConflictError extends SandboxError {
  constructor(message = "Sandbox is not in a valid state for this operation") {
    super(message, 409)
    this.name = "ConflictError"
  }
}

export class TimeoutError extends SandboxError {
  constructor(message = "Request timed out") {
    super(message)
    this.name = "TimeoutError"
  }
}

export class ServerError extends SandboxError {
  constructor(message = "Internal server error") {
    super(message, 500)
    this.name = "ServerError"
  }
}

/**
 * Map an HTTP status code and response body to a typed error.
 * @internal
 */
export function mapApiError(
  status: number,
  body: { error?: { code?: string; message?: string } },
): SandboxError {
  const message = body?.error?.message ?? `API error (${status})`
  const code = body?.error?.code

  switch (status) {
    case 400:
      return new ValidationError(message)
    case 401:
      return new AuthenticationError(message)
    case 404:
      return new NotFoundError(message)
    case 409:
      return new ConflictError(message)
    default:
      if (status >= 500) return new ServerError(message)
      return new SandboxError(message, status, code)
  }
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd packages/sdk && npx tsc --noEmit src/types.ts src/errors.ts 2>&1 || true
```

This may fail because there's no `index.ts` yet — that's fine. We're checking for syntax errors only.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/types.ts packages/sdk/src/errors.ts
git commit -m "add sdk types and error hierarchy"
```

---

## Task 5: TypeScript SDK — HTTP Client and Config

**Files:**
- Create: `packages/sdk/src/config.ts`
- Create: `packages/sdk/src/http.ts`

- [ ] **Step 1: Create `packages/sdk/src/config.ts`**

```typescript
/**
 * Connection configuration for the Superserve SDK.
 *
 * Resolves API key and base URLs from explicit options or environment
 * variables. Constructs the data-plane URL for per-sandbox file operations.
 */

const DEFAULT_BASE_URL = "https://api.superserve.ai"
const DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"

export interface ResolvedConfig {
  apiKey: string
  baseUrl: string
  sandboxHost: string
}

/**
 * Resolve connection config from explicit options + environment variables.
 *
 * Priority: explicit option > SUPERSERVE_API_KEY / SUPERSERVE_BASE_URL env vars.
 * Throws if no API key can be resolved.
 */
export function resolveConfig(opts?: {
  apiKey?: string
  baseUrl?: string
}): ResolvedConfig {
  const apiKey = opts?.apiKey ?? process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new Error(
      "Missing API key. Pass `apiKey` or set the SUPERSERVE_API_KEY environment variable.",
    )
  }
  const baseUrl = opts?.baseUrl ?? process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
  const sandboxHost = deriveSandboxHost(baseUrl)
  return { apiKey, baseUrl, sandboxHost }
}

/**
 * Build the data-plane base URL for a specific sandbox.
 *
 * Example: `https://boxd-{sandboxId}.sandbox.superserve.ai`
 */
export function dataPlaneUrl(sandboxId: string, sandboxHost: string): string {
  return `https://boxd-${sandboxId}.${sandboxHost}`
}

/**
 * Derive the sandbox host from the control-plane base URL.
 *
 * `https://api.superserve.ai`         → `sandbox.superserve.ai`
 * `https://api-staging.superserve.ai`  → `sandbox.superserve.ai`
 * `http://localhost:8080`              → `sandbox.superserve.ai` (fallback)
 */
function deriveSandboxHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    if (url.hostname.endsWith("superserve.ai")) {
      return DEFAULT_SANDBOX_HOST
    }
  } catch {
    // Invalid URL — use default
  }
  return DEFAULT_SANDBOX_HOST
}
```

- [ ] **Step 2: Create `packages/sdk/src/http.ts`**

```typescript
/**
 * Minimal HTTP client wrapping native `fetch`.
 *
 * Handles:
 * - Auth header injection (`X-API-Key`)
 * - JSON request/response serialization
 * - Error mapping to typed SDK errors
 * - Request timeout via AbortController
 * - SSE stream parsing for exec/stream endpoint
 */

import { mapApiError, SandboxError, TimeoutError } from "./errors.js"
import type { ApiExecStreamEvent } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

/**
 * Make an HTTP request and return parsed JSON.
 *
 * Throws typed SandboxError subclasses on non-2xx responses.
 */
export async function request<T>(opts: RequestOptions): Promise<T> {
  const { method, url, headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Make a request that returns no body (204 expected).
 */
export async function requestVoid(opts: RequestOptions): Promise<void> {
  await request<void>(opts)
}

/**
 * Upload raw bytes to a URL. Used for file upload to the data plane.
 */
export async function uploadBytes(opts: {
  url: string
  headers: Record<string, string>
  body: BodyInit
  timeoutMs?: number
}): Promise<void> {
  const { url, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        ...headers,
      },
      body,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Upload timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Upload error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download raw bytes from a URL. Used for file download from the data plane.
 */
export async function downloadBytes(opts: {
  url: string
  headers: Record<string, string>
  timeoutMs?: number
}): Promise<Uint8Array> {
  const { url, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }

    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Download timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Download error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Consume an SSE stream from the exec/stream endpoint.
 *
 * Calls `onEvent` for each parsed event. Returns when the stream ends
 * (server sends `finished: true` or closes the connection).
 */
export async function streamSSE(opts: {
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs?: number
  onEvent: (event: ApiExecStreamEvent) => void
}): Promise<void> {
  const { url, headers, body, timeoutMs = 300_000, onEvent } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }

    if (!res.body) {
      throw new SandboxError("Expected streaming response but got empty body")
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const json = line.slice(6).trim()
        if (!json || json === "[DONE]") continue
        try {
          const event = JSON.parse(json) as ApiExecStreamEvent
          onEvent(event)
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Stream timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/config.ts packages/sdk/src/http.ts
git commit -m "add sdk http client and config"
```

---

## Task 6: TypeScript SDK — Polling Utility

**Files:**
- Create: `packages/sdk/src/polling.ts`

- [ ] **Step 1: Create `packages/sdk/src/polling.ts`**

```typescript
/**
 * Polling utility for waiting on sandbox status transitions.
 *
 * Used internally by Sandbox.create() (wait for active) and can be
 * called directly via sandbox.waitForReady().
 */

import { request } from "./http.js"
import { TimeoutError } from "./errors.js"
import type { SandboxStatus, ApiSandboxResponse, SandboxInfo } from "./types.js"
import { toSandboxInfo } from "./types.js"

interface WaitOptions {
  /** Maximum wait time in ms. Default 60_000 (60s). */
  timeoutMs?: number
  /** Poll interval in ms. Default 1_000 (1s). */
  intervalMs?: number
}

/**
 * Poll `GET /sandboxes/{id}` until status matches `target`.
 *
 * Uses linear polling (not exponential) — sandbox boot is typically 2-5s,
 * so 1s intervals hit the sweet spot between responsiveness and API load.
 *
 * @returns The SandboxInfo once the target status is reached.
 * @throws TimeoutError if the deadline elapses.
 */
export async function waitForStatus(
  sandboxId: string,
  target: SandboxStatus,
  baseUrl: string,
  apiKey: string,
  opts: WaitOptions = {},
): Promise<SandboxInfo> {
  const { timeoutMs = 60_000, intervalMs = 1_000 } = opts
  const deadline = Date.now() + timeoutMs
  let lastStatus: string | undefined

  while (Date.now() < deadline) {
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": apiKey },
    })
    lastStatus = raw.status
    if (raw.status === target) {
      return toSandboxInfo(raw)
    }
    await sleep(intervalMs)
  }

  throw new TimeoutError(
    `Timed out after ${timeoutMs}ms waiting for sandbox ${sandboxId} ` +
      `to reach "${target}". Last status: "${lastStatus ?? "unknown"}".`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sdk/src/polling.ts
git commit -m "add sandbox status polling utility"
```

---

## Task 7: TypeScript SDK — Commands Sub-Module

**Files:**
- Create: `packages/sdk/src/commands.ts`

- [ ] **Step 1: Create `packages/sdk/src/commands.ts`**

```typescript
/**
 * Commands sub-module for executing shell commands inside a sandbox.
 *
 * Supports two modes:
 * - Synchronous: waits for command to finish, returns stdout/stderr/exitCode
 * - Streaming: fires onStdout/onStderr callbacks via SSE, then returns result
 *
 * Accessed as `sandbox.commands.run(...)`.
 */

import { request, streamSSE } from "./http.js"
import type {
  CommandResult,
  CommandOptions,
  ApiExecResult,
  ApiExecStreamEvent,
} from "./types.js"

export class Commands {
  /** @internal */
  constructor(
    private readonly _baseUrl: string,
    private readonly _sandboxId: string,
    private readonly _apiKey: string,
  ) {}

  /**
   * Execute a command inside the sandbox.
   *
   * If `onStdout` or `onStderr` callbacks are provided, the command is
   * streamed via SSE. Otherwise, it runs synchronously (waits for completion).
   *
   * Idle sandboxes are automatically resumed by the API before execution.
   *
   * @example
   * ```typescript
   * // Synchronous
   * const result = await sandbox.commands.run("echo hello")
   * console.log(result.stdout) // "hello\n"
   *
   * // Streaming
   * const result = await sandbox.commands.run("npm start", {
   *   onStdout: (data) => process.stdout.write(data),
   *   onStderr: (data) => process.stderr.write(data),
   *   timeoutSeconds: 120,
   * })
   * ```
   */
  async run(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const { cwd, env, timeoutSeconds, onStdout, onStderr } = options
    const isStreaming = onStdout !== undefined || onStderr !== undefined

    const body: Record<string, unknown> = { command }
    if (cwd) body.working_dir = cwd
    if (env) body.env = env
    if (timeoutSeconds) body.timeout_s = timeoutSeconds

    const authHeaders = { "X-API-Key": this._apiKey }

    if (isStreaming) {
      return this._runStreaming(body, authHeaders, options)
    }
    return this._runSync(body, authHeaders, options)
  }

  private async _runSync(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const raw = await request<ApiExecResult>({
      method: "POST",
      url: `${this._baseUrl}/sandboxes/${this._sandboxId}/exec`,
      headers,
      body,
      timeoutMs: options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined,
    })
    return {
      stdout: raw.stdout ?? "",
      stderr: raw.stderr ?? "",
      exitCode: raw.exit_code ?? 0,
    }
  }

  private async _runStreaming(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    options: CommandOptions,
  ): Promise<CommandResult> {
    let stdout = ""
    let stderr = ""
    let exitCode = 0
    let error: string | undefined

    await streamSSE({
      url: `${this._baseUrl}/sandboxes/${this._sandboxId}/exec/stream`,
      headers,
      body,
      timeoutMs: options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined,
      onEvent: (event: ApiExecStreamEvent) => {
        if (event.stdout) {
          stdout += event.stdout
          options.onStdout?.(event.stdout)
        }
        if (event.stderr) {
          stderr += event.stderr
          options.onStderr?.(event.stderr)
        }
        if (event.finished) {
          exitCode = event.exit_code ?? 0
          error = event.error
        }
      },
    })

    if (error) {
      stderr += error
    }

    return { stdout, stderr, exitCode }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sdk/src/commands.ts
git commit -m "add commands sub-module"
```

---

## Task 8: TypeScript SDK — Files Sub-Module

**Files:**
- Create: `packages/sdk/src/files.ts`

- [ ] **Step 1: Create `packages/sdk/src/files.ts`**

```typescript
/**
 * Files sub-module for uploading/downloading files to/from a sandbox.
 *
 * Hits the data-plane directly at `boxd-{id}.sandbox.superserve.ai`
 * using the per-sandbox access token. The control-plane API key is
 * not used for file operations.
 *
 * Accessed as `sandbox.files.write(...)` / `sandbox.files.read(...)`.
 */

import { uploadBytes, downloadBytes } from "./http.js"
import { dataPlaneUrl } from "./config.js"
import type { FileInput } from "./types.js"

export class Files {
  private readonly _dataPlaneBaseUrl: string

  /** @internal */
  constructor(
    sandboxId: string,
    sandboxHost: string,
    private readonly _accessToken: string,
  ) {
    this._dataPlaneBaseUrl = dataPlaneUrl(sandboxId, sandboxHost)
  }

  /**
   * Write a file to the sandbox at the given absolute path.
   *
   * Parent directories are created automatically by the sandbox agent.
   * The path must start with `/` and must not contain `..` segments.
   *
   * @example
   * ```typescript
   * await sandbox.files.write("/app/config.json", '{"key": "value"}')
   * await sandbox.files.write("/app/binary.dat", buffer)
   * ```
   */
  async write(path: string, content: FileInput, timeoutMs?: number): Promise<void> {
    const body = toBody(content)
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    await uploadBytes({
      url,
      headers: { "X-Access-Token": this._accessToken },
      body,
      timeoutMs,
    })
  }

  /**
   * Read a file from the sandbox as raw bytes.
   *
   * @example
   * ```typescript
   * const bytes = await sandbox.files.read("/app/config.json")
   * ```
   */
  async read(path: string, timeoutMs?: number): Promise<Uint8Array> {
    const url = `${this._dataPlaneBaseUrl}/files?path=${encodeURIComponent(path)}`
    return downloadBytes({
      url,
      headers: { "X-Access-Token": this._accessToken },
      timeoutMs,
    })
  }

  /**
   * Read a file from the sandbox as a UTF-8 string.
   *
   * @example
   * ```typescript
   * const text = await sandbox.files.readText("/app/config.json")
   * console.log(text) // '{"key": "value"}'
   * ```
   */
  async readText(path: string, timeoutMs?: number): Promise<string> {
    const bytes = await this.read(path, timeoutMs)
    return new TextDecoder().decode(bytes)
  }
}

/** Convert FileInput to a BodyInit suitable for fetch. */
function toBody(content: FileInput): BodyInit {
  if (typeof content === "string") {
    return new TextEncoder().encode(content)
  }
  if (content instanceof Uint8Array) {
    return content
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content)
  }
  // Buffer (Node.js) extends Uint8Array, handled above
  // Blob
  return content as Blob
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sdk/src/files.ts
git commit -m "add files sub-module"
```

---

## Task 9: TypeScript SDK — Sandbox Class

**Files:**
- Create: `packages/sdk/src/Sandbox.ts`

- [ ] **Step 1: Create `packages/sdk/src/Sandbox.ts`**

```typescript
/**
 * Main Sandbox class — the primary entry point for the Superserve SDK.
 *
 * Uses the E2B pattern: static factory methods (create/connect), sub-modules
 * as properties (.commands, .files), dual static/instance lifecycle methods.
 *
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const sandbox = await Sandbox.create({ name: "my-sandbox" })
 * const result = await sandbox.commands.run("echo hello")
 * await sandbox.files.write("/app/data.txt", "content")
 * await sandbox.kill()
 * ```
 */

import { resolveConfig, type ResolvedConfig } from "./config.js"
import { request, requestVoid } from "./http.js"
import { waitForStatus } from "./polling.js"
import { Commands } from "./commands.js"
import { Files } from "./files.js"
import type {
  SandboxInfo,
  SandboxStatus,
  SandboxCreateOptions,
  SandboxListOptions,
  SandboxUpdateOptions,
  ConnectionOptions,
  ApiSandboxResponse,
  NetworkConfig,
} from "./types.js"
import { toSandboxInfo } from "./types.js"

export class Sandbox {
  /** Unique sandbox ID (UUID). */
  readonly id: string

  /** Human-readable sandbox name. */
  readonly name: string

  /** Current sandbox status. Call `getInfo()` to refresh. */
  status: SandboxStatus

  /** User-supplied metadata tags. */
  metadata: Record<string, string>

  /**
   * Per-sandbox access token for data-plane operations.
   * Used internally by the Files sub-module. Exposed for advanced use cases.
   */
  readonly accessToken: string

  /** Execute shell commands inside this sandbox. */
  readonly commands: Commands

  /** Upload and download files to/from this sandbox. */
  readonly files: Files

  private readonly _config: ResolvedConfig

  /** @internal — Use Sandbox.create() or Sandbox.connect() instead. */
  private constructor(info: SandboxInfo, config: ResolvedConfig) {
    this.id = info.id
    this.name = info.name
    this.status = info.status
    this.metadata = info.metadata
    this.accessToken = info.accessToken
    this._config = config

    this.commands = new Commands(config.baseUrl, this.id, config.apiKey)
    this.files = new Files(this.id, config.sandboxHost, this.accessToken)
  }

  // -------------------------------------------------------------------------
  // Static factory methods
  // -------------------------------------------------------------------------

  /**
   * Create a new sandbox and return a connected Sandbox instance.
   *
   * Returns immediately after the API confirms creation (status may be
   * `starting`). Call `await sandbox.waitForReady()` to block until `active`.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.create({ name: "my-sandbox" })
   * await sandbox.waitForReady()
   * ```
   */
  static async create(options: SandboxCreateOptions): Promise<Sandbox> {
    const config = resolveConfig(options)

    const body: Record<string, unknown> = { name: options.name }
    if (options.fromSnapshot) body.from_snapshot = options.fromSnapshot
    if (options.timeoutSeconds) body.timeout_seconds = options.timeoutSeconds
    if (options.metadata) body.metadata = options.metadata
    if (options.envVars) body.env_vars = options.envVars
    if (options.network) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }

    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${config.baseUrl}/sandboxes`,
      headers: { "X-API-Key": config.apiKey },
      body,
    })

    return new Sandbox(toSandboxInfo(raw), config)
  }

  /**
   * Connect to an existing sandbox by ID.
   *
   * Fetches the sandbox info and access token, returns a ready-to-use instance.
   *
   * @example
   * ```typescript
   * const sandbox = await Sandbox.connect("sandbox-uuid")
   * ```
   */
  static async connect(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<Sandbox> {
    const config = resolveConfig(options)

    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
    })

    return new Sandbox(toSandboxInfo(raw), config)
  }

  /**
   * List all sandboxes belonging to the authenticated team.
   *
   * @param options.metadata — Filter by metadata key-value pairs.
   *
   * @example
   * ```typescript
   * const sandboxes = await Sandbox.list()
   * const prodBoxes = await Sandbox.list({ metadata: { env: "prod" } })
   * ```
   */
  static async list(options: SandboxListOptions = {}): Promise<SandboxInfo[]> {
    const config = resolveConfig(options)

    let url = `${config.baseUrl}/sandboxes`
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.metadata)) {
        params.set(`metadata.${key}`, value)
      }
      url += `?${params.toString()}`
    }

    const raw = await request<ApiSandboxResponse[]>({
      method: "GET",
      url,
      headers: { "X-API-Key": config.apiKey },
    })

    return raw.map(toSandboxInfo)
  }

  /**
   * Get sandbox info by ID without creating a full Sandbox instance.
   */
  static async get(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<SandboxInfo> {
    const config = resolveConfig(options)
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
    })
    return toSandboxInfo(raw)
  }

  /**
   * Delete a sandbox by ID.
   */
  static async kill(
    sandboxId: string,
    options: ConnectionOptions = {},
  ): Promise<void> {
    const config = resolveConfig(options)
    await requestVoid({
      method: "DELETE",
      url: `${config.baseUrl}/sandboxes/${sandboxId}`,
      headers: { "X-API-Key": config.apiKey },
    })
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle methods
  // -------------------------------------------------------------------------

  /**
   * Refresh this sandbox's info from the API. Updates `status` and `metadata`.
   */
  async getInfo(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "GET",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    const info = toSandboxInfo(raw)
    this.status = info.status
    this.metadata = info.metadata
    return info
  }

  /**
   * Pause this sandbox. Snapshots full state (memory + disk), suspends the VM.
   * Status transitions to `idle`.
   */
  async pause(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/pause`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    const info = toSandboxInfo(raw)
    this.status = info.status
    return info
  }

  /**
   * Resume this sandbox from paused state. Restores from snapshot.
   * Status transitions back to `active`.
   */
  async resume(): Promise<SandboxInfo> {
    const raw = await request<ApiSandboxResponse>({
      method: "POST",
      url: `${this._config.baseUrl}/sandboxes/${this.id}/resume`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    const info = toSandboxInfo(raw)
    this.status = info.status
    return info
  }

  /**
   * Delete this sandbox and all its resources.
   */
  async kill(): Promise<void> {
    await requestVoid({
      method: "DELETE",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
    })
    this.status = "deleted"
  }

  /**
   * Partially update this sandbox (metadata, network rules).
   */
  async update(options: SandboxUpdateOptions): Promise<void> {
    const body: Record<string, unknown> = {}
    if (options.metadata) body.metadata = options.metadata
    if (options.network) {
      body.network = {
        allow_out: options.network.allowOut,
        deny_out: options.network.denyOut,
      }
    }

    await requestVoid({
      method: "PATCH",
      url: `${this._config.baseUrl}/sandboxes/${this.id}`,
      headers: { "X-API-Key": this._config.apiKey },
      body,
    })

    if (options.metadata) this.metadata = options.metadata
  }

  /**
   * Wait for this sandbox to reach `active` status.
   *
   * Useful after `Sandbox.create()` since the API returns immediately
   * with `status: starting`.
   *
   * @param timeoutMs Maximum wait time. Default 60s.
   */
  async waitForReady(timeoutMs = 60_000): Promise<SandboxInfo> {
    const info = await waitForStatus(
      this.id,
      "active",
      this._config.baseUrl,
      this._config.apiKey,
      { timeoutMs },
    )
    this.status = info.status
    return info
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sdk/src/Sandbox.ts
git commit -m "add sandbox class with lifecycle and sub-modules"
```

---

## Task 10: TypeScript SDK — Public Exports and Build

**Files:**
- Create: `packages/sdk/src/index.ts`

- [ ] **Step 1: Create `packages/sdk/src/index.ts`**

```typescript
/**
 * Superserve SDK — sandbox infrastructure for running code in isolated cloud environments.
 *
 * @example
 * ```typescript
 * import { Sandbox } from "@superserve/sdk"
 *
 * const sandbox = await Sandbox.create({ name: "my-sandbox" })
 * await sandbox.waitForReady()
 *
 * const result = await sandbox.commands.run("echo hello")
 * console.log(result.stdout)
 *
 * await sandbox.files.write("/app/data.txt", "content")
 * const text = await sandbox.files.readText("/app/data.txt")
 *
 * await sandbox.kill()
 * ```
 *
 * @packageDocumentation
 */

export { Sandbox } from "./Sandbox.js"

export type {
  SandboxInfo,
  SandboxStatus,
  SandboxCreateOptions,
  SandboxListOptions,
  SandboxUpdateOptions,
  ConnectionOptions,
  CommandResult,
  CommandOptions,
  NetworkConfig,
  FileInput,
} from "./types.js"

export {
  SandboxError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  TimeoutError,
  ServerError,
} from "./errors.js"
```

- [ ] **Step 2: Build the SDK**

```bash
cd packages/sdk && bun run build
```

Expected: Compiles to `dist/` with `index.js`, `index.cjs`, `index.d.ts`.

- [ ] **Step 3: Verify the build output exports correctly**

```bash
cd packages/sdk && node -e "const sdk = require('./dist/index.cjs'); console.log(Object.keys(sdk))"
```

Expected output should include: `Sandbox`, `SandboxError`, `AuthenticationError`, `ValidationError`, `NotFoundError`, `ConflictError`, `TimeoutError`, `ServerError`.

- [ ] **Step 4: Run typecheck**

```bash
cd packages/sdk && bun run typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/index.ts
git commit -m "add public exports and verify build"
```

---

## Task 11: Python SDK — Types and Errors

**Files:**
- Create: `packages/python-sdk/src/superserve/types.py`
- Create: `packages/python-sdk/src/superserve/errors.py`

- [ ] **Step 1: Create `packages/python-sdk/src/superserve/types.py`**

```python
"""Core types for the Superserve Python SDK.

Pydantic models that mirror the API response shapes. The SDK converts
snake_case API responses to these models internally.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------


class SandboxStatus(str, Enum):
    STARTING = "starting"
    ACTIVE = "active"
    PAUSING = "pausing"
    IDLE = "idle"
    DELETED = "deleted"


class NetworkConfig(BaseModel):
    allow_out: Optional[List[str]] = None
    deny_out: Optional[List[str]] = None


class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int = 0
    memory_mib: int = 0
    access_token: str = ""
    snapshot_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    timeout_seconds: Optional[int] = None
    network: Optional[NetworkConfig] = None
    metadata: Dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


class CommandResult(BaseModel):
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def to_sandbox_info(raw: Dict[str, Any]) -> SandboxInfo:
    """Convert an API response dict to a SandboxInfo model."""
    network = None
    if raw.get("network"):
        network = NetworkConfig(
            allow_out=raw["network"].get("allow_out"),
            deny_out=raw["network"].get("deny_out"),
        )

    return SandboxInfo(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        status=SandboxStatus(raw.get("status", "starting")),
        vcpu_count=raw.get("vcpu_count", 0),
        memory_mib=raw.get("memory_mib", 0),
        access_token=raw.get("access_token", ""),
        snapshot_id=raw.get("snapshot_id"),
        created_at=datetime.fromisoformat(raw["created_at"])
        if raw.get("created_at")
        else datetime.now(),
        timeout_seconds=raw.get("timeout_seconds"),
        network=network,
        metadata=raw.get("metadata", {}),
    )
```

- [ ] **Step 2: Create `packages/python-sdk/src/superserve/errors.py`**

```python
"""Typed error hierarchy for the Superserve Python SDK.

Maps HTTP status codes to specific error classes.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class SandboxError(Exception):
    """Base error for all Superserve SDK errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class AuthenticationError(SandboxError):
    """Raised on 401 — missing or invalid API key."""

    def __init__(self, message: str = "Missing or invalid API key") -> None:
        super().__init__(message, status_code=401)


class ValidationError(SandboxError):
    """Raised on 400 — invalid request."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class NotFoundError(SandboxError):
    """Raised on 404 — resource not found."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, status_code=404)


class ConflictError(SandboxError):
    """Raised on 409 — sandbox is not in a valid state."""

    def __init__(
        self, message: str = "Sandbox is not in a valid state for this operation"
    ) -> None:
        super().__init__(message, status_code=409)


class TimeoutError(SandboxError):
    """Raised when a request or polling operation times out."""

    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(message)


class ServerError(SandboxError):
    """Raised on 5xx — internal server error."""

    def __init__(self, message: str = "Internal server error") -> None:
        super().__init__(message, status_code=500)


def map_api_error(
    status_code: int, body: Dict[str, Any]
) -> SandboxError:
    """Map an HTTP status code and response body to a typed error."""
    error_data = body.get("error", {})
    message = error_data.get("message", f"API error ({status_code})")

    if status_code == 400:
        return ValidationError(message)
    elif status_code == 401:
        return AuthenticationError(message)
    elif status_code == 404:
        return NotFoundError(message)
    elif status_code == 409:
        return ConflictError(message)
    elif status_code >= 500:
        return ServerError(message)
    return SandboxError(message, status_code=status_code)
```

- [ ] **Step 3: Commit**

```bash
git add packages/python-sdk/src/superserve/types.py packages/python-sdk/src/superserve/errors.py
git commit -m "add python sdk types and error hierarchy"
```

---

## Task 12: Python SDK — HTTP Client and Config

**Files:**
- Create: `packages/python-sdk/src/superserve/_config.py`
- Create: `packages/python-sdk/src/superserve/_http.py`
- Create: `packages/python-sdk/src/superserve/py.typed` (PEP 561 marker)

- [ ] **Step 1: Create `packages/python-sdk/src/superserve/_config.py`**

```python
"""Connection configuration for the Superserve Python SDK."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_BASE_URL = "https://api.superserve.ai"
DEFAULT_SANDBOX_HOST = "sandbox.superserve.ai"


@dataclass(frozen=True)
class ResolvedConfig:
    api_key: str
    base_url: str
    sandbox_host: str


def resolve_config(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> ResolvedConfig:
    """Resolve connection config from explicit args + environment variables.

    Priority: explicit arg > SUPERSERVE_API_KEY / SUPERSERVE_BASE_URL env vars.
    Raises ValueError if no API key can be resolved.
    """
    resolved_key = api_key or os.environ.get("SUPERSERVE_API_KEY")
    if not resolved_key:
        raise ValueError(
            "Missing API key. Pass `api_key` or set the "
            "SUPERSERVE_API_KEY environment variable."
        )
    resolved_url = base_url or os.environ.get("SUPERSERVE_BASE_URL", DEFAULT_BASE_URL)
    sandbox_host = _derive_sandbox_host(resolved_url)
    return ResolvedConfig(
        api_key=resolved_key,
        base_url=resolved_url,
        sandbox_host=sandbox_host,
    )


def data_plane_url(sandbox_id: str, sandbox_host: str) -> str:
    """Build the data-plane base URL for a specific sandbox."""
    return f"https://boxd-{sandbox_id}.{sandbox_host}"


def _derive_sandbox_host(base_url: str) -> str:
    """Derive the sandbox host from the control-plane base URL."""
    from urllib.parse import urlparse

    try:
        parsed = urlparse(base_url)
        if parsed.hostname and parsed.hostname.endswith("superserve.ai"):
            return DEFAULT_SANDBOX_HOST
    except Exception:
        pass
    return DEFAULT_SANDBOX_HOST


# Allow Optional without importing from typing at module level
from typing import Optional  # noqa: E402
```

- [ ] **Step 2: Create `packages/python-sdk/src/superserve/_http.py`**

```python
"""Minimal HTTP client wrapping httpx.

Handles auth header injection, JSON serialization, error mapping,
and request timeouts. Provides both sync and async variants.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterator, Optional

import httpx

from .errors import SandboxError, TimeoutError, map_api_error

DEFAULT_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


def api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Make a JSON API request. Returns parsed response body or None for 204."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.request(
                method,
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            )
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Request timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Network error: {exc}") from exc

    if response.status_code == 204:
        return None

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)

    return response.json()


def upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
) -> None:
    """Upload raw bytes (file upload to data plane)."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                url,
                headers={**headers, "Content-Type": "application/octet-stream"},
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)


def download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Download raw bytes (file download from data plane)."""
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Download timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Download error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)

    return response.content


def stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
) -> None:
    """Consume an SSE stream from the exec/stream endpoint."""
    import json as json_module

    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            ) as response:
                if not response.is_success:
                    response.read()
                    try:
                        body = response.json()
                    except Exception:
                        body = {}
                    raise map_api_error(response.status_code, body)

                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json_module.loads(data)
                        on_event(event)
                    except json_module.JSONDecodeError:
                        pass
    except SandboxError:
        raise
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Stream timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Stream error: {exc}") from exc


# ---------------------------------------------------------------------------
# Async
# ---------------------------------------------------------------------------


async def async_api_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Optional[Any] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Async variant of api_request."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method,
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            )
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Request timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Network error: {exc}") from exc

    if response.status_code == 204:
        return None

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)

    return response.json()


async def async_upload_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    content: bytes,
    timeout: float = DEFAULT_TIMEOUT,
) -> None:
    """Async variant of upload_bytes."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers={**headers, "Content-Type": "application/octet-stream"},
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Upload timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Upload error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)


async def async_download_bytes(
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float = DEFAULT_TIMEOUT,
) -> bytes:
    """Async variant of download_bytes."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Download timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Download error: {exc}") from exc

    if not response.is_success:
        try:
            body = response.json()
        except Exception:
            body = {}
        raise map_api_error(response.status_code, body)

    return response.content


async def async_stream_sse(
    url: str,
    *,
    headers: Dict[str, str],
    json_body: Any,
    timeout: float = 300.0,
    on_event: Callable[[Dict[str, Any]], None],
) -> None:
    """Async variant of stream_sse."""
    import json as json_module

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
            ) as response:
                if not response.is_success:
                    await response.aread()
                    try:
                        body = response.json()
                    except Exception:
                        body = {}
                    raise map_api_error(response.status_code, body)

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json_module.loads(data)
                        on_event(event)
                    except json_module.JSONDecodeError:
                        pass
    except SandboxError:
        raise
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"Stream timed out after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise SandboxError(f"Stream error: {exc}") from exc
```

- [ ] **Step 3: Create PEP 561 marker**

```bash
touch packages/python-sdk/src/superserve/py.typed
```

- [ ] **Step 4: Commit**

```bash
git add packages/python-sdk/src/superserve/_config.py packages/python-sdk/src/superserve/_http.py packages/python-sdk/src/superserve/py.typed
git commit -m "add python sdk http client and config"
```

---

## Task 13: Python SDK — Polling, Commands, Files

**Files:**
- Create: `packages/python-sdk/src/superserve/_polling.py`
- Create: `packages/python-sdk/src/superserve/commands.py`
- Create: `packages/python-sdk/src/superserve/files.py`

- [ ] **Step 1: Create `packages/python-sdk/src/superserve/_polling.py`**

```python
"""Polling utility for waiting on sandbox status transitions."""

from __future__ import annotations

import time
from typing import Optional

from ._config import ResolvedConfig
from ._http import api_request, async_api_request
from .errors import TimeoutError
from .types import SandboxInfo, SandboxStatus, to_sandbox_info


def wait_for_status(
    sandbox_id: str,
    target: SandboxStatus,
    config: ResolvedConfig,
    *,
    timeout_seconds: float = 60.0,
    interval_seconds: float = 1.0,
) -> SandboxInfo:
    """Poll GET /sandboxes/{id} until status matches target."""
    deadline = time.monotonic() + timeout_seconds
    last_status: Optional[str] = None

    while time.monotonic() < deadline:
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        last_status = raw.get("status")
        if last_status == target.value:
            return to_sandbox_info(raw)
        time.sleep(interval_seconds)

    raise TimeoutError(
        f"Timed out after {timeout_seconds}s waiting for sandbox {sandbox_id} "
        f'to reach "{target.value}". Last status: "{last_status or "unknown"}".'
    )


async def async_wait_for_status(
    sandbox_id: str,
    target: SandboxStatus,
    config: ResolvedConfig,
    *,
    timeout_seconds: float = 60.0,
    interval_seconds: float = 1.0,
) -> SandboxInfo:
    """Async variant of wait_for_status."""
    import asyncio

    deadline = time.monotonic() + timeout_seconds
    last_status: Optional[str] = None

    while time.monotonic() < deadline:
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        last_status = raw.get("status")
        if last_status == target.value:
            return to_sandbox_info(raw)
        await asyncio.sleep(interval_seconds)

    raise TimeoutError(
        f"Timed out after {timeout_seconds}s waiting for sandbox {sandbox_id} "
        f'to reach "{target.value}". Last status: "{last_status or "unknown"}".'
    )
```

- [ ] **Step 2: Create `packages/python-sdk/src/superserve/commands.py`**

```python
"""Commands sub-module for executing shell commands inside a sandbox."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from ._http import api_request, async_api_request, stream_sse, async_stream_sse
from .types import CommandResult


class Commands:
    """Sync command execution. Access as ``sandbox.commands``."""

    def __init__(self, base_url: str, sandbox_id: str, api_key: str) -> None:
        self._base_url = base_url
        self._sandbox_id = sandbox_id
        self._api_key = api_key

    def run(
        self,
        command: str,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
    ) -> CommandResult:
        """Execute a command inside the sandbox.

        If ``on_stdout`` or ``on_stderr`` are provided, the command is
        streamed via SSE. Otherwise, waits for completion synchronously.
        """
        body: Dict[str, Any] = {"command": command}
        if cwd:
            body["working_dir"] = cwd
        if env:
            body["env"] = env
        if timeout_seconds:
            body["timeout_s"] = timeout_seconds

        headers = {"X-API-Key": self._api_key}
        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return self._run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
        return self._run_sync(body, headers, timeout_seconds)

    def _run_sync(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        raw = api_request(
            "POST",
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) if timeout_seconds else 30.0,
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    def _run_streaming(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        on_stdout: Optional[Callable[[str], None]],
        on_stderr: Optional[Callable[[str], None]],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0

        def handle_event(event: Dict[str, Any]) -> None:
            nonlocal exit_code
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        stream_sse(
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec/stream",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) if timeout_seconds else 300.0,
            on_event=handle_event,
        )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )


class AsyncCommands:
    """Async command execution. Access as ``sandbox.commands``."""

    def __init__(self, base_url: str, sandbox_id: str, api_key: str) -> None:
        self._base_url = base_url
        self._sandbox_id = sandbox_id
        self._api_key = api_key

    async def run(
        self,
        command: str,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout_seconds: Optional[int] = None,
        on_stdout: Optional[Callable[[str], None]] = None,
        on_stderr: Optional[Callable[[str], None]] = None,
    ) -> CommandResult:
        """Async variant of Commands.run()."""
        body: Dict[str, Any] = {"command": command}
        if cwd:
            body["working_dir"] = cwd
        if env:
            body["env"] = env
        if timeout_seconds:
            body["timeout_s"] = timeout_seconds

        headers = {"X-API-Key": self._api_key}
        is_streaming = on_stdout is not None or on_stderr is not None

        if is_streaming:
            return await self._run_streaming(body, headers, on_stdout, on_stderr, timeout_seconds)
        return await self._run_sync(body, headers, timeout_seconds)

    async def _run_sync(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        raw = await async_api_request(
            "POST",
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) if timeout_seconds else 30.0,
        )
        return CommandResult(
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", 0),
        )

    async def _run_streaming(
        self,
        body: Dict[str, Any],
        headers: Dict[str, str],
        on_stdout: Optional[Callable[[str], None]],
        on_stderr: Optional[Callable[[str], None]],
        timeout_seconds: Optional[int],
    ) -> CommandResult:
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code = 0

        def handle_event(event: Dict[str, Any]) -> None:
            nonlocal exit_code
            if event.get("stdout"):
                stdout_parts.append(event["stdout"])
                if on_stdout:
                    on_stdout(event["stdout"])
            if event.get("stderr"):
                stderr_parts.append(event["stderr"])
                if on_stderr:
                    on_stderr(event["stderr"])
            if event.get("finished"):
                exit_code = event.get("exit_code", 0)
                if event.get("error"):
                    stderr_parts.append(event["error"])

        await async_stream_sse(
            f"{self._base_url}/sandboxes/{self._sandbox_id}/exec/stream",
            headers=headers,
            json_body=body,
            timeout=float(timeout_seconds) if timeout_seconds else 300.0,
            on_event=handle_event,
        )

        return CommandResult(
            stdout="".join(stdout_parts),
            stderr="".join(stderr_parts),
            exit_code=exit_code,
        )
```

- [ ] **Step 3: Create `packages/python-sdk/src/superserve/files.py`**

```python
"""Files sub-module for uploading/downloading files to/from a sandbox."""

from __future__ import annotations

from typing import Optional, Union
from urllib.parse import quote

from ._config import data_plane_url
from ._http import (
    upload_bytes,
    download_bytes,
    async_upload_bytes,
    async_download_bytes,
)


class Files:
    """Sync file operations. Access as ``sandbox.files``."""

    def __init__(
        self, sandbox_id: str, sandbox_host: str, access_token: str
    ) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token

    def write(
        self,
        path: str,
        content: Union[str, bytes],
        *,
        timeout: Optional[float] = None,
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}, "content": content}
        if timeout is not None:
            kwargs["timeout"] = timeout
        upload_bytes(**kwargs)

    def read(
        self,
        path: str,
        *,
        timeout: Optional[float] = None,
    ) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}}
        if timeout is not None:
            kwargs["timeout"] = timeout
        return download_bytes(**kwargs)

    def read_text(
        self,
        path: str,
        *,
        timeout: Optional[float] = None,
    ) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        return self.read(path, timeout=timeout).decode("utf-8")


class AsyncFiles:
    """Async file operations. Access as ``sandbox.files``."""

    def __init__(
        self, sandbox_id: str, sandbox_host: str, access_token: str
    ) -> None:
        self._base_url = data_plane_url(sandbox_id, sandbox_host)
        self._access_token = access_token

    async def write(
        self,
        path: str,
        content: Union[str, bytes],
        *,
        timeout: Optional[float] = None,
    ) -> None:
        """Write a file to the sandbox at the given absolute path."""
        if isinstance(content, str):
            content = content.encode("utf-8")
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}, "content": content}
        if timeout is not None:
            kwargs["timeout"] = timeout
        await async_upload_bytes(**kwargs)

    async def read(
        self,
        path: str,
        *,
        timeout: Optional[float] = None,
    ) -> bytes:
        """Read a file from the sandbox as raw bytes."""
        url = f"{self._base_url}/files?path={quote(path, safe='')}"
        kwargs = {"url": url, "headers": {"X-Access-Token": self._access_token}}
        if timeout is not None:
            kwargs["timeout"] = timeout
        return await async_download_bytes(**kwargs)

    async def read_text(
        self,
        path: str,
        *,
        timeout: Optional[float] = None,
    ) -> str:
        """Read a file from the sandbox as a UTF-8 string."""
        raw = await self.read(path, timeout=timeout)
        return raw.decode("utf-8")
```

- [ ] **Step 4: Commit**

```bash
git add packages/python-sdk/src/superserve/_polling.py packages/python-sdk/src/superserve/commands.py packages/python-sdk/src/superserve/files.py
git commit -m "add python sdk polling, commands, and files"
```

---

## Task 14: Python SDK — Sandbox and AsyncSandbox Classes

**Files:**
- Create: `packages/python-sdk/src/superserve/sandbox.py`
- Create: `packages/python-sdk/src/superserve/async_sandbox.py`

- [ ] **Step 1: Create `packages/python-sdk/src/superserve/sandbox.py`**

```python
"""Sync Sandbox class — primary entry point for the Superserve Python SDK.

Usage::

    from superserve import Sandbox

    sandbox = Sandbox.create(name="my-sandbox")
    sandbox.wait_for_ready()

    result = sandbox.commands.run("echo hello")
    print(result.stdout)

    sandbox.files.write("/app/data.txt", b"content")
    text = sandbox.files.read_text("/app/data.txt")

    sandbox.kill()
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._config import ResolvedConfig, resolve_config
from ._http import api_request
from ._polling import wait_for_status
from .commands import Commands
from .files import Files
from .types import (
    NetworkConfig,
    SandboxInfo,
    SandboxStatus,
    to_sandbox_info,
)


class Sandbox:
    """A connected sandbox instance with lifecycle methods and sub-modules."""

    def __init__(self, info: SandboxInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: Dict[str, str] = info.metadata
        self.access_token: str = info.access_token
        self._config = config

        self.commands = Commands(config.base_url, self.id, config.api_key)
        self.files = Files(self.id, config.sandbox_host, self.access_token)

    # ----- Static factory methods -----

    @classmethod
    def create(
        cls,
        *,
        name: str,
        from_snapshot: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        metadata: Optional[Dict[str, str]] = None,
        env_vars: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Sandbox:
        """Create a new sandbox."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: Dict[str, Any] = {"name": name}
        if from_snapshot:
            body["from_snapshot"] = from_snapshot
        if timeout_seconds:
            body["timeout_seconds"] = timeout_seconds
        if metadata:
            body["metadata"] = metadata
        if env_vars:
            body["env_vars"] = env_vars
        if network:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        raw = api_request(
            "POST",
            f"{config.base_url}/sandboxes",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Sandbox:
        """Connect to an existing sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    def list(
        cls,
        *,
        metadata: Optional[Dict[str, str]] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> List[SandboxInfo]:
        """List all sandboxes belonging to the authenticated team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/sandboxes"
        if metadata:
            from urllib.parse import urlencode

            params = {f"metadata.{k}": v for k, v in metadata.items()}
            url += f"?{urlencode(params)}"

        raw = api_request("GET", url, headers={"X-API-Key": config.api_key})
        return [to_sandbox_info(item) for item in raw]

    @classmethod
    def get(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> SandboxInfo:
        """Get sandbox info by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return to_sandbox_info(raw)

    @classmethod
    def kill(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        api_request(
            "DELETE",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )

    # ----- Instance lifecycle methods -----

    def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        raw = api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        self.metadata = info.metadata
        return info

    def pause(self) -> SandboxInfo:
        """Pause this sandbox. Snapshots state, suspends the VM."""
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        return info

    def resume(self) -> SandboxInfo:
        """Resume this sandbox from paused state."""
        raw = api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/resume",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        return info

    def kill_instance(self) -> None:
        """Delete this sandbox and all its resources."""
        api_request(
            "DELETE",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        self.status = SandboxStatus.DELETED

    def update(
        self,
        *,
        metadata: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
    ) -> None:
        """Partially update this sandbox."""
        body: Dict[str, Any] = {}
        if metadata is not None:
            body["metadata"] = metadata
        if network is not None:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        api_request(
            "PATCH",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
        )
        if metadata is not None:
            self.metadata = metadata

    def wait_for_ready(self, timeout_seconds: float = 60.0) -> SandboxInfo:
        """Wait for this sandbox to reach active status."""
        info = wait_for_status(
            self.id, SandboxStatus.ACTIVE, self._config, timeout_seconds=timeout_seconds
        )
        self.status = info.status
        return info
```

- [ ] **Step 2: Create `packages/python-sdk/src/superserve/async_sandbox.py`**

```python
"""Async Sandbox class for the Superserve Python SDK.

Usage::

    from superserve import AsyncSandbox

    sandbox = await AsyncSandbox.create(name="my-sandbox")
    await sandbox.wait_for_ready()

    result = await sandbox.commands.run("echo hello")
    print(result.stdout)

    await sandbox.kill_instance()
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ._config import ResolvedConfig, resolve_config
from ._http import async_api_request
from ._polling import async_wait_for_status
from .commands import AsyncCommands
from .files import AsyncFiles
from .types import (
    NetworkConfig,
    SandboxInfo,
    SandboxStatus,
    to_sandbox_info,
)


class AsyncSandbox:
    """Async variant of Sandbox with identical API surface."""

    def __init__(self, info: SandboxInfo, config: ResolvedConfig) -> None:
        self.id: str = info.id
        self.name: str = info.name
        self.status: SandboxStatus = info.status
        self.metadata: Dict[str, str] = info.metadata
        self.access_token: str = info.access_token
        self._config = config

        self.commands = AsyncCommands(config.base_url, self.id, config.api_key)
        self.files = AsyncFiles(self.id, config.sandbox_host, self.access_token)

    # ----- Static factory methods -----

    @classmethod
    async def create(
        cls,
        *,
        name: str,
        from_snapshot: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        metadata: Optional[Dict[str, str]] = None,
        env_vars: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSandbox:
        """Create a new sandbox."""
        config = resolve_config(api_key=api_key, base_url=base_url)

        body: Dict[str, Any] = {"name": name}
        if from_snapshot:
            body["from_snapshot"] = from_snapshot
        if timeout_seconds:
            body["timeout_seconds"] = timeout_seconds
        if metadata:
            body["metadata"] = metadata
        if env_vars:
            body["env_vars"] = env_vars
        if network:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        raw = await async_api_request(
            "POST",
            f"{config.base_url}/sandboxes",
            headers={"X-API-Key": config.api_key},
            json_body=body,
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    async def connect(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> AsyncSandbox:
        """Connect to an existing sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return cls(to_sandbox_info(raw), config)

    @classmethod
    async def list(
        cls,
        *,
        metadata: Optional[Dict[str, str]] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> List[SandboxInfo]:
        """List all sandboxes belonging to the authenticated team."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        url = f"{config.base_url}/sandboxes"
        if metadata:
            from urllib.parse import urlencode

            params = {f"metadata.{k}": v for k, v in metadata.items()}
            url += f"?{urlencode(params)}"

        raw = await async_api_request(
            "GET", url, headers={"X-API-Key": config.api_key}
        )
        return [to_sandbox_info(item) for item in raw]

    @classmethod
    async def get(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> SandboxInfo:
        """Get sandbox info by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        raw = await async_api_request(
            "GET",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )
        return to_sandbox_info(raw)

    @classmethod
    async def kill(
        cls,
        sandbox_id: str,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        """Delete a sandbox by ID."""
        config = resolve_config(api_key=api_key, base_url=base_url)
        await async_api_request(
            "DELETE",
            f"{config.base_url}/sandboxes/{sandbox_id}",
            headers={"X-API-Key": config.api_key},
        )

    # ----- Instance lifecycle methods -----

    async def get_info(self) -> SandboxInfo:
        """Refresh this sandbox's info from the API."""
        raw = await async_api_request(
            "GET",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        self.metadata = info.metadata
        return info

    async def pause(self) -> SandboxInfo:
        """Pause this sandbox."""
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/pause",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        return info

    async def resume(self) -> SandboxInfo:
        """Resume this sandbox from paused state."""
        raw = await async_api_request(
            "POST",
            f"{self._config.base_url}/sandboxes/{self.id}/resume",
            headers={"X-API-Key": self._config.api_key},
        )
        info = to_sandbox_info(raw)
        self.status = info.status
        return info

    async def kill_instance(self) -> None:
        """Delete this sandbox and all its resources."""
        await async_api_request(
            "DELETE",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
        )
        self.status = SandboxStatus.DELETED

    async def update(
        self,
        *,
        metadata: Optional[Dict[str, str]] = None,
        network: Optional[NetworkConfig] = None,
    ) -> None:
        """Partially update this sandbox."""
        body: Dict[str, Any] = {}
        if metadata is not None:
            body["metadata"] = metadata
        if network is not None:
            body["network"] = {
                "allow_out": network.allow_out,
                "deny_out": network.deny_out,
            }

        await async_api_request(
            "PATCH",
            f"{self._config.base_url}/sandboxes/{self.id}",
            headers={"X-API-Key": self._config.api_key},
            json_body=body,
        )
        if metadata is not None:
            self.metadata = metadata

    async def wait_for_ready(self, timeout_seconds: float = 60.0) -> SandboxInfo:
        """Wait for this sandbox to reach active status."""
        info = await async_wait_for_status(
            self.id, SandboxStatus.ACTIVE, self._config, timeout_seconds=timeout_seconds
        )
        self.status = info.status
        return info
```

- [ ] **Step 3: Commit**

```bash
git add packages/python-sdk/src/superserve/sandbox.py packages/python-sdk/src/superserve/async_sandbox.py
git commit -m "add python sandbox and async sandbox classes"
```

---

## Task 15: Python SDK — Public Exports and Verify

**Files:**
- Create: `packages/python-sdk/src/superserve/__init__.py`

- [ ] **Step 1: Create `packages/python-sdk/src/superserve/__init__.py`**

```python
"""Superserve Python SDK — sandbox infrastructure for running code in isolated cloud environments.

Usage::

    from superserve import Sandbox

    sandbox = Sandbox.create(name="my-sandbox")
    sandbox.wait_for_ready()

    result = sandbox.commands.run("echo hello")
    print(result.stdout)

    sandbox.kill_instance()
"""

from .sandbox import Sandbox
from .async_sandbox import AsyncSandbox
from .types import (
    CommandResult,
    NetworkConfig,
    SandboxInfo,
    SandboxStatus,
)
from .errors import (
    SandboxError,
    AuthenticationError,
    ValidationError,
    NotFoundError,
    ConflictError,
    TimeoutError,
    ServerError,
)

__all__ = [
    "Sandbox",
    "AsyncSandbox",
    "CommandResult",
    "NetworkConfig",
    "SandboxInfo",
    "SandboxStatus",
    "SandboxError",
    "AuthenticationError",
    "ValidationError",
    "NotFoundError",
    "ConflictError",
    "TimeoutError",
    "ServerError",
]
```

- [ ] **Step 2: Verify Python SDK imports work**

```bash
cd packages/python-sdk && uv run python -c "from superserve import Sandbox, AsyncSandbox, SandboxInfo, SandboxError; print('imports ok')"
```

Expected: `imports ok`

- [ ] **Step 3: Commit**

```bash
git add packages/python-sdk/src/superserve/__init__.py
git commit -m "add python sdk public exports"
```

---

## Task 16: Update E2E Tests — TypeScript

**Files:**
- Modify: `tests/sdk-e2e-ts/src/client.ts`
- Modify: `tests/sdk-e2e-ts/src/polling.ts`
- Modify: `tests/sdk-e2e-ts/tests/sandboxes.test.ts`
- Modify: `tests/sdk-e2e-ts/tests/exec.test.ts`
- Modify: `tests/sdk-e2e-ts/tests/files.test.ts`
- Modify: `tests/sdk-e2e-ts/tests/system.test.ts`

- [ ] **Step 1: Rewrite `tests/sdk-e2e-ts/src/client.ts`**

```typescript
/**
 * Shared test helpers for the e2e test suite.
 */

import { Sandbox } from "@superserve/sdk"
import type { ConnectionOptions } from "@superserve/sdk"

const DEFAULT_BASE_URL = "https://api-staging.superserve.ai"

/** Unique per test run. Used in sandbox names + metadata tags. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** True when credentials are available to hit a live environment. */
export function hasCredentials(): boolean {
  return Boolean(process.env.SUPERSERVE_API_KEY)
}

/** Connection options for all SDK calls. */
export function connectionOptions(): ConnectionOptions {
  const apiKey = process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new Error(
      "SUPERSERVE_API_KEY is not set. Guard the suite with describe.skipIf(!hasCredentials())."
    )
  }
  const baseUrl = process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
  return { apiKey, baseUrl }
}
```

- [ ] **Step 2: Simplify `tests/sdk-e2e-ts/src/polling.ts`**

The polling utility is now built into the SDK. Replace with a thin re-export:

```typescript
/**
 * Polling is now built into the SDK (sandbox.waitForReady()).
 * This file remains for any custom polling needs in tests.
 */

export { type SandboxStatus } from "@superserve/sdk"
```

- [ ] **Step 3: Rewrite test files to use new SDK API**

Read each existing test file, then rewrite using the new `Sandbox.create()` / `sandbox.commands.run()` pattern. The key changes:

- `new SuperserveClient(...)` → `Sandbox.create(...)` / `Sandbox.connect(...)`
- `client.sandboxes.createSandbox(...)` → `Sandbox.create({ name: "..." })`
- `client.sandboxes.getSandbox(...)` → `Sandbox.get(id)`
- `client.sandboxes.listSandboxes()` → `Sandbox.list()`
- `client.sandboxes.deleteSandbox(id)` → `Sandbox.kill(id)` or `sandbox.kill()`
- `client.sandboxes.pauseSandbox(id)` → `sandbox.pause()`
- `client.sandboxes.resumeSandbox(id)` → `sandbox.resume()`
- `client.sandboxes.patchSandbox(id, ...)` → `sandbox.update(...)`
- `client.exec.execCommand(id, ...)` → `sandbox.commands.run(...)`
- `waitForStatus(client, id, "active")` → `sandbox.waitForReady()`
- File operations use `sandbox.files.write(...)` / `sandbox.files.read(...)`

The exact test rewrites depend on reading the current test files — implement the same test scenarios with the new API.

- [ ] **Step 4: Delete `tests/sdk-e2e-ts/tests/system.test.ts`**

The system health check (`GET /health`) is not exposed in the new SDK (it's an infrastructure endpoint, not user-facing). Delete this test file.

- [ ] **Step 5: Run typecheck on tests**

```bash
cd tests/sdk-e2e-ts && bun run typecheck
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add tests/sdk-e2e-ts/
git commit -m "update typescript e2e tests for new sdk api"
```

---

## Task 17: Update E2E Tests — Python

**Files:**
- Modify: `tests/sdk-e2e-py/conftest.py`
- Modify: `tests/sdk-e2e-py/_helpers.py`
- Modify: `tests/sdk-e2e-py/test_sandboxes.py`
- Modify: `tests/sdk-e2e-py/test_exec.py`
- Modify: `tests/sdk-e2e-py/test_files.py`
- Delete: `tests/sdk-e2e-py/test_system.py`

- [ ] **Step 1: Read existing Python test files**

Read `conftest.py`, `_helpers.py`, and all `test_*.py` files to understand current test scenarios.

- [ ] **Step 2: Rewrite `conftest.py`**

Replace the Fern client fixture with the new SDK:

```python
import os
import pytest
from superserve import Sandbox

@pytest.fixture(scope="session")
def run_id():
    import time, random, string
    ts = hex(int(time.time()))[2:]
    rand = "".join(random.choices(string.ascii_lowercase, k=4))
    return f"{ts}{rand}"

@pytest.fixture(scope="session")
def connection_opts():
    return {
        "api_key": os.environ.get("SUPERSERVE_API_KEY"),
        "base_url": os.environ.get("SUPERSERVE_BASE_URL", "https://api-staging.superserve.ai"),
    }
```

- [ ] **Step 3: Rewrite `_helpers.py`**

```python
import os
import pytest

SKIP_IF_NO_CREDS = pytest.mark.skipif(
    not os.environ.get("SUPERSERVE_API_KEY"),
    reason="SUPERSERVE_API_KEY not set",
)
```

The `wait_for_status` helper is now `sandbox.wait_for_ready()` in the SDK.

- [ ] **Step 4: Rewrite test files**

Apply the same mapping as TypeScript tests:
- `client.sandboxes.create_sandbox(...)` → `Sandbox.create(name=..., **opts)`
- `client.sandboxes.get_sandbox(id)` → `Sandbox.get(id, **opts)`
- `client.exec.exec_command(id, ...)` → `sandbox.commands.run(...)`
- `wait_for_status(client, id, "active")` → `sandbox.wait_for_ready()`
- File operations: `sandbox.files.write(...)` / `sandbox.files.read(...)`

- [ ] **Step 5: Delete `test_system.py`**

```bash
rm tests/sdk-e2e-py/test_system.py
```

- [ ] **Step 6: Verify Python tests parse**

```bash
cd tests/sdk-e2e-py && uv run python -m pytest --collect-only 2>&1 | head -20
```

Expected: Tests are collected (may show skip markers if no credentials).

- [ ] **Step 7: Commit**

```bash
git add tests/sdk-e2e-py/
git commit -m "update python e2e tests for new sdk api"
```

---

## Task 18: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `packages/sdk/README.md`
- Modify: `packages/python-sdk/README.md`

- [ ] **Step 1: Update CLAUDE.md**

Remove all Fern-related sections:
- Remove the "SDK & Docs Generation (Fern)" subsection under "Monorepo Structure"
- Update the "TypeScript SDK" description to say "Hand-crafted SDK" instead of "Generated by Fern"
- Update the "Python SDK" description similarly
- Remove `generate*` and `docs:*` from the Development commands section
- Remove `.fernignore` from any file references

- [ ] **Step 2: Update `packages/sdk/README.md`**

Write a concise README showing the new API:

```markdown
# @superserve/sdk

TypeScript SDK for the Superserve sandbox API.

## Installation

```bash
npm install @superserve/sdk
```

## Quick Start

```typescript
import { Sandbox } from "@superserve/sdk"

const sandbox = await Sandbox.create({ name: "my-sandbox" })
await sandbox.waitForReady()

const result = await sandbox.commands.run("echo hello")
console.log(result.stdout)

await sandbox.files.write("/app/data.txt", "content")
const text = await sandbox.files.readText("/app/data.txt")

await sandbox.kill()
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable, or pass `apiKey` explicitly:

```typescript
const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "ss_live_...",
})
```
```

- [ ] **Step 3: Update `packages/python-sdk/README.md`**

```markdown
# superserve

Python SDK for the Superserve sandbox API.

## Installation

```bash
pip install superserve
```

## Quick Start

```python
from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox")
sandbox.wait_for_ready()

result = sandbox.commands.run("echo hello")
print(result.stdout)

sandbox.files.write("/app/data.txt", b"content")
text = sandbox.files.read_text("/app/data.txt")

sandbox.kill_instance()
```

## Async

```python
from superserve import AsyncSandbox

sandbox = await AsyncSandbox.create(name="my-sandbox")
await sandbox.wait_for_ready()

result = await sandbox.commands.run("echo hello")
await sandbox.kill_instance()
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable, or pass `api_key` explicitly:

```python
sandbox = Sandbox.create(name="my-sandbox", api_key="ss_live_...")
```
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md packages/sdk/README.md packages/python-sdk/README.md
git commit -m "update docs for hand-crafted sdk"
```

---

## Task 19: Restore Mintlify Docs (Skeleton)

**Files:**
- Create: `docs/docs.json`
- Create: `docs/introduction.mdx`
- Create: `docs/quickstart.mdx`
- Modify: Root `package.json` (add mintlify scripts)

- [ ] **Step 1: Create `docs/docs.json`**

Based on the Mintlify config from commit `afb2781`, updated for the current sandbox product:

```json
{
  "$schema": "https://mintlify.com/docs.json",
  "theme": "maple",
  "name": "Superserve",
  "colors": {
    "primary": "#105C60",
    "light": "#119CA3",
    "dark": "#0d474a"
  },
  "fonts": {
    "heading": {
      "family": "Funnel Display",
      "weight": 600
    },
    "body": {
      "family": "Inter"
    }
  },
  "background": {
    "color": {
      "light": "#faf8f5",
      "dark": "#1a1816"
    },
    "decoration": "gradient"
  },
  "styling": {
    "codeblocks": {
      "theme": {
        "light": "github-light",
        "dark": "vitesse-dark"
      }
    }
  },
  "favicon": "/favicon.svg",
  "logo": {
    "light": "/logo/light.svg",
    "dark": "/logo/dark.svg",
    "href": "https://superserve.ai"
  },
  "appearance": {
    "default": "light"
  },
  "navbar": {
    "primary": {
      "type": "github",
      "href": "https://github.com/superserve-ai/superserve"
    }
  },
  "navigation": {
    "tabs": [
      {
        "tab": "Documentation",
        "groups": [
          {
            "group": "Get Started",
            "pages": [
              "introduction",
              "quickstart"
            ]
          }
        ]
      },
      {
        "tab": "SDK Reference",
        "groups": [
          {
            "group": "TypeScript SDK",
            "pages": [
              "sdk/typescript/sandbox",
              "sdk/typescript/commands",
              "sdk/typescript/files"
            ]
          },
          {
            "group": "Python SDK",
            "pages": [
              "sdk/python/sandbox",
              "sdk/python/commands",
              "sdk/python/files"
            ]
          }
        ]
      }
    ]
  },
  "footer": {
    "socials": {
      "x": "https://x.com/superserve_ai",
      "github": "https://github.com/superserve-ai/",
      "linkedin": "https://www.linkedin.com/company/super-serve-ai/"
    }
  },
  "integrations": {
    "posthog": {
      "apiKey": "phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre",
      "apiHost": "https://us.i.posthog.com"
    }
  }
}
```

- [ ] **Step 2: Create `docs/introduction.mdx`**

```mdx
---
title: Introduction
description: Superserve provides sandbox infrastructure to run code in isolated cloud environments powered by Firecracker MicroVMs.
---

# Superserve

Superserve provides sandbox infrastructure to run code in isolated cloud environments. Each sandbox is a Firecracker MicroVM running Ubuntu 24.04 with Python 3.12, Node.js 22, and common dev tools pre-installed.

## What you can do

- **Create sandboxes** — spin up isolated VMs in seconds
- **Execute commands** — run shell commands with real-time streaming output
- **Transfer files** — upload and download files to/from sandboxes
- **Pause & resume** — snapshot sandbox state and restore it later
- **Network controls** — configure egress allow/deny rules per sandbox

## SDKs

<CardGroup cols={2}>
  <Card title="TypeScript" href="/quickstart#typescript">
    `npm install @superserve/sdk`
  </Card>
  <Card title="Python" href="/quickstart#python">
    `pip install superserve`
  </Card>
</CardGroup>
```

- [ ] **Step 3: Create `docs/quickstart.mdx`**

```mdx
---
title: Quickstart
description: Get up and running with Superserve in under 5 minutes.
---

## Prerequisites

Get your API key from the [Superserve Console](https://console.superserve.ai).

Set it as an environment variable:

```bash
export SUPERSERVE_API_KEY=ss_live_...
```

## TypeScript

Install the SDK:

```bash
npm install @superserve/sdk
```

Create and use a sandbox:

```typescript
import { Sandbox } from "@superserve/sdk"

// Create a sandbox
const sandbox = await Sandbox.create({ name: "quickstart" })
await sandbox.waitForReady()

// Run a command
const result = await sandbox.commands.run("echo 'Hello from Superserve!'")
console.log(result.stdout)

// Write and read a file
await sandbox.files.write("/tmp/hello.txt", "Hello, world!")
const content = await sandbox.files.readText("/tmp/hello.txt")
console.log(content)

// Clean up
await sandbox.kill()
```

## Python

Install the SDK:

```bash
pip install superserve
```

Create and use a sandbox:

```python
from superserve import Sandbox

# Create a sandbox
sandbox = Sandbox.create(name="quickstart")
sandbox.wait_for_ready()

# Run a command
result = sandbox.commands.run("echo 'Hello from Superserve!'")
print(result.stdout)

# Write and read a file
sandbox.files.write("/tmp/hello.txt", b"Hello, world!")
content = sandbox.files.read_text("/tmp/hello.txt")
print(content)

# Clean up
sandbox.kill_instance()
```
```

- [ ] **Step 4: Add Mintlify scripts to root `package.json`**

Add to the `scripts` section:

```json
"docs:dev": "mintlify dev --dir docs",
"docs:build": "mintlify build --dir docs"
```

Add to `devDependencies`:

```json
"mintlify": "^4.0.0"
```

- [ ] **Step 5: Commit**

```bash
git add docs/ package.json
git commit -m "restore mintlify docs with updated sdk content"
```

---

## Task 20: Final Build and Typecheck

- [ ] **Step 1: Install dependencies (lockfile may need updating)**

```bash
bun install
```

- [ ] **Step 2: Build the TypeScript SDK**

```bash
bunx turbo run build --filter=@superserve/sdk
```

Expected: Clean build, outputs to `packages/sdk/dist/`.

- [ ] **Step 3: Typecheck the TypeScript SDK**

```bash
bunx turbo run typecheck --filter=@superserve/sdk
```

Expected: No errors.

- [ ] **Step 4: Typecheck e2e tests**

```bash
cd tests/sdk-e2e-ts && bun run typecheck
```

Expected: No errors.

- [ ] **Step 5: Verify Python SDK imports**

```bash
cd packages/python-sdk && uv run python -c "
from superserve import Sandbox, AsyncSandbox, SandboxInfo, CommandResult
from superserve import SandboxError, NotFoundError, AuthenticationError
print('All imports OK')
print('Sandbox methods:', [m for m in dir(Sandbox) if not m.startswith('_')])
"
```

Expected: All imports succeed, methods list includes `create`, `connect`, `list`, `get`, `kill`, `pause`, `resume`, `kill_instance`, `update`, `get_info`, `wait_for_ready`.

- [ ] **Step 6: Run biome check on SDK**

```bash
cd packages/sdk && bunx biome check --write .
```

- [ ] **Step 7: Commit any formatting fixes**

```bash
git add -A
git commit -m "fix formatting"
```
