# SDK From Scratch — Design Spec

## Context

Superserve currently uses Fern to auto-generate both the TypeScript and Python SDKs from an OpenAPI spec. The generated SDKs are thin REST wrappers with awkward DX — notably, file operations require users to construct a separate client with a different base URL and manually pass access tokens. Documentation is also Fern-hosted.

We're replacing this with hand-crafted SDKs modeled after E2B and Daytona — the two closest competitors in the sandbox infrastructure space. We're also restoring Mintlify for documentation (previously used before Fern, commit `afb2781`).

## Goals

1. **Best-in-class DX** — single `Sandbox` class, sub-module pattern, hide control-plane/data-plane split
2. **Robust, typed code** — full TypeScript types, Pydantic models in Python, typed error hierarchy
3. **Extensible** — structure accommodates snapshots, code execution, templates/method-chaining without breaking changes
4. **Match or beat E2B/Daytona** — fewer concepts, faster "aha" moment, cleaner API surface

## Non-Goals

- PTY / interactive terminal in SDK
- Git operations
- File watching
- Computer use / desktop automation
- These may come later; the architecture must not preclude them

---

## 1. SDK Architecture

### 1.1 Single Sandbox Class (E2B Pattern)

One class, static factory methods, sub-modules as properties:

```
Sandbox (class)
├── Static: create(), connect(), list(), get(), kill()
├── Instance: pause(), resume(), kill(), getInfo(), update()
├── .commands: Commands  (command execution)
└── .files: Files        (file operations via data-plane)
```

**Why this over Daytona's two-class pattern:**
- Fewer concepts (1 import, 1 class)
- 3 lines from zero to running code
- Static + instance duality covers both stateful and serverless use cases
- Our API surface is focused (no volumes, org-level ops) — no need for a separate orchestrator

### 1.2 Auth Resolution

Priority order:
1. Explicit `apiKey` option passed to `Sandbox.create()` / `Sandbox.connect()`
2. `SUPERSERVE_API_KEY` environment variable

No constructor — auth is passed to static factory methods and stored on the instance.

### 1.3 Data-Plane Abstraction

The SDK internally handles the control-plane / data-plane split:

- **Control plane** (`api.superserve.ai`): Sandbox lifecycle, exec — uses `X-API-Key`
- **Data plane** (`boxd-{id}.sandbox.superserve.ai`): File operations — uses `X-Access-Token`

After `Sandbox.create()` or `Sandbox.connect()`, the SDK stores the `access_token` from the response and constructs the data-plane URL automatically. Users never see this.

### 1.4 Environment Configuration

```typescript
// Default: production
const sandbox = await Sandbox.create({ name: "my-sandbox" })

// Override base URL (for staging, local dev)
const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "ss_live_...",
  baseUrl: "https://api-staging.superserve.ai",
})
```

The sandbox host suffix (`sandbox.superserve.ai`) is derived from the base URL or configurable via `sandboxHost` option for local development.

---

## 2. TypeScript SDK

### 2.1 Public API

```typescript
import { Sandbox } from "@superserve/sdk"

// === Lifecycle ===

// Create a new sandbox
const sandbox = await Sandbox.create({
  name: "my-sandbox",               // required
  fromSnapshot?: "snapshot-uuid",    // optional: boot from snapshot
  timeoutSeconds?: 3600,            // optional: hard lifetime cap
  metadata?: { env: "prod" },       // optional: string-to-string tags
  envVars?: { API_KEY: "..." },     // optional: injected into all processes
  network?: {                       // optional: egress rules
    allowOut: ["api.openai.com"],
    denyOut: ["0.0.0.0/0"],
  },
  // Auth (optional — falls back to SUPERSERVE_API_KEY env var)
  apiKey?: "ss_live_...",
  baseUrl?: "https://api.superserve.ai",
})

// Connect to an existing sandbox (fetches info + access_token)
const sandbox = await Sandbox.connect(sandboxId, { apiKey?, baseUrl? })

// Static lifecycle (manage by ID, no instance needed)
const sandboxes: SandboxInfo[] = await Sandbox.list({ apiKey?, baseUrl?, metadata? })
const info: SandboxInfo = await Sandbox.get(sandboxId, { apiKey?, baseUrl? })
await Sandbox.kill(sandboxId, { apiKey?, baseUrl? })

// Instance lifecycle
await sandbox.pause()    // → idle
await sandbox.resume()   // → active
await sandbox.kill()     // → deleted
const info: SandboxInfo = await sandbox.getInfo()  // refresh status
await sandbox.update({   // PATCH - partial update
  metadata?: { ... },
  network?: { ... },
})

// Properties (set after create/connect)
sandbox.id          // string (UUID)
sandbox.status      // "starting" | "active" | "pausing" | "idle" | "deleted"
sandbox.metadata    // Record<string, string>
sandbox.accessToken // string (for advanced use — normally internal)

// === Commands ===

// Synchronous execution (waits for completion)
const result = await sandbox.commands.run("echo hello", {
  cwd?: "/app",
  env?: { NODE_ENV: "production" },
  timeoutSeconds?: 30,
})
// result: { stdout: string, stderr: string, exitCode: number }

// Streaming execution (SSE consumed internally, callbacks for real-time output)
const result = await sandbox.commands.run("npm start", {
  onStdout: (data: string) => console.log(data),
  onStderr: (data: string) => console.error(data),
  timeoutSeconds?: 120,
})

// === Files ===

// Write a file (auto-creates parent dirs)
await sandbox.files.write("/app/config.json", '{"key": "value"}')
await sandbox.files.write("/app/binary.dat", buffer)  // Buffer | Uint8Array | Blob

// Read a file
const content: Uint8Array = await sandbox.files.read("/app/config.json")
const text: string = await sandbox.files.readText("/app/config.json")

// Future (not in v1, but API surface is reserved):
// await sandbox.files.list("/app")
// await sandbox.files.exists("/app/config.json")
// await sandbox.files.remove("/app/old.txt")
```

### 2.2 Types

```typescript
// Sandbox info returned from API
interface SandboxInfo {
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

type SandboxStatus = "starting" | "active" | "pausing" | "idle" | "deleted"

interface NetworkConfig {
  allowOut?: string[]
  denyOut?: string[]
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
}

interface SandboxCreateOptions {
  name: string
  fromSnapshot?: string
  timeoutSeconds?: number
  metadata?: Record<string, string>
  envVars?: Record<string, string>
  network?: NetworkConfig
  apiKey?: string
  baseUrl?: string
}

interface SandboxConnectOptions {
  apiKey?: string
  baseUrl?: string
}

interface SandboxListOptions {
  apiKey?: string
  baseUrl?: string
  metadata?: Record<string, string>
}
```

### 2.3 Error Hierarchy

```typescript
class SandboxError extends Error {
  statusCode?: number
  code?: string
}

class AuthenticationError extends SandboxError {}  // 401
class NotFoundError extends SandboxError {}        // 404
class ConflictError extends SandboxError {}        // 409 (wrong state)
class ValidationError extends SandboxError {}      // 400
class TimeoutError extends SandboxError {}          // request timeout
class ServerError extends SandboxError {}           // 500
```

### 2.4 File Structure

```
packages/sdk/src/
├── index.ts          # Public exports: Sandbox, types, errors
├── Sandbox.ts        # Main class: static methods, lifecycle, sub-module init
├── commands.ts       # Commands class: run() with sync/streaming
├── files.ts          # Files class: read(), readText(), write()
├── http.ts           # HTTP client wrapper (fetch-based): request(), stream()
├── config.ts         # ConnectionConfig: apiKey/baseUrl resolution, data-plane URL construction
├── errors.ts         # Error classes + HTTP status → error mapping
├── types.ts          # All interfaces and type aliases
└── polling.ts        # waitForStatus(): poll GET /sandboxes/{id} until target status
```

### 2.5 Internal Patterns

**HTTP client (`http.ts`):**
- Thin wrapper around `fetch`
- Handles: auth header injection, JSON serialization, error mapping, request timeout via `AbortController`
- SSE streaming: parses `text/event-stream` for exec/stream endpoint
- No external dependencies beyond Node.js built-ins

**Polling (`polling.ts`):**
- `Sandbox.create()` returns after the API responds with `status: starting`
- If the user wants to wait for `active`, they call `await sandbox.waitForReady()`
- Polls `GET /sandboxes/{id}` with exponential backoff (100ms → 200ms → 400ms → ... cap 2s)
- Times out after configurable duration (default 60s)

**Data-plane URL construction (`config.ts`):**
- Default: `https://boxd-{sandboxId}.sandbox.superserve.ai`
- Derives sandbox host from control-plane URL when non-default (e.g., staging)
- Overridable via `sandboxHost` option for local dev

### 2.6 Build & Publish

- **Bundler:** tsup (already configured in package.json)
- **Output:** ESM + CJS dual format
- **Target:** ES2020+ (matches current tsconfig)
- **Dependencies:** None (zero runtime deps — uses native `fetch`)
- **Peer deps:** None
- **Package name:** `@superserve/sdk` (unchanged)

---

## 3. Python SDK

### 3.1 Public API

```python
from superserve import Sandbox

# Create
sandbox = Sandbox.create(
    name="my-sandbox",
    from_snapshot="snapshot-uuid",       # optional
    timeout_seconds=3600,               # optional
    metadata={"env": "prod"},           # optional
    env_vars={"API_KEY": "..."},        # optional
    api_key="ss_live_...",              # optional, falls back to env var
    base_url="https://api.superserve.ai",  # optional
)

# Connect
sandbox = Sandbox.connect("sandbox-id")

# Static
sandboxes = Sandbox.list()
info = Sandbox.get("sandbox-id")
Sandbox.kill("sandbox-id")

# Instance
sandbox.pause()
sandbox.resume()
sandbox.kill()
info = sandbox.get_info()

# Commands
result = sandbox.commands.run("echo hello")
print(result.stdout)

result = sandbox.commands.run("npm start",
    on_stdout=lambda data: print(data),
    on_stderr=lambda data: print(data, file=sys.stderr),
    timeout_seconds=120,
)

# Files
sandbox.files.write("/app/config.json", b'{"key": "value"}')
content = sandbox.files.read("/app/config.json")       # bytes
text = sandbox.files.read_text("/app/config.json")      # str

# Async variant
from superserve import AsyncSandbox

sandbox = await AsyncSandbox.create(name="my-sandbox")
result = await sandbox.commands.run("echo hello")
await sandbox.files.write("/app/file.txt", b"data")
await sandbox.kill()
```

### 3.2 Types (Pydantic models)

```python
class SandboxInfo(BaseModel):
    id: str
    name: str
    status: SandboxStatus
    vcpu_count: int
    memory_mib: int
    access_token: str
    snapshot_id: Optional[str] = None
    created_at: datetime
    timeout_seconds: Optional[int] = None
    network: Optional[NetworkConfig] = None
    metadata: dict[str, str]

class SandboxStatus(str, Enum):
    STARTING = "starting"
    ACTIVE = "active"
    PAUSING = "pausing"
    IDLE = "idle"
    DELETED = "deleted"

class CommandResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int

class NetworkConfig(BaseModel):
    allow_out: Optional[list[str]] = None
    deny_out: Optional[list[str]] = None
```

### 3.3 Error Hierarchy

```python
class SandboxError(Exception):
    status_code: Optional[int]
    code: Optional[str]
    message: str

class AuthenticationError(SandboxError): ...  # 401
class NotFoundError(SandboxError): ...        # 404
class ConflictError(SandboxError): ...        # 409
class ValidationError(SandboxError): ...      # 400
class TimeoutError(SandboxError): ...         # request timeout
class ServerError(SandboxError): ...          # 500
```

### 3.4 File Structure

```
packages/python-sdk/src/superserve/
├── __init__.py           # Public exports
├── sandbox.py            # Sandbox (sync)
├── async_sandbox.py      # AsyncSandbox (async)
├── commands.py           # Commands + AsyncCommands
├── files.py              # Files + AsyncFiles
├── _http.py              # httpx-based client (sync + async)
├── _config.py            # ConnectionConfig
├── errors.py             # Error hierarchy
├── types.py              # Pydantic models
└── _polling.py           # wait_for_status()
```

### 3.5 Build & Publish

- **Runtime deps:** `httpx>=0.24.0`, `pydantic>=2.0.0` (same as current)
- **Python support:** ≥3.9 (same as current)
- **Package name:** `superserve` on PyPI (unchanged)
- **Build:** uv build (unchanged)

---

## 4. Fern Removal

### Files/directories to delete:
- `/fern/` — entire directory
- `/packages/sdk/src/api/` — generated resource clients
- `/packages/sdk/src/core/` — generated HTTP/auth core
- `/packages/sdk/src/auth/` — generated auth
- `/packages/sdk/src/errors/` — generated errors
- `/packages/sdk/src/Client.ts` — generated main client
- `/packages/sdk/src/BaseClient.ts` — generated base client
- `/packages/sdk/src/environments.ts` — generated environments
- `/packages/sdk/src/exports.ts` — generated exports
- `/packages/sdk/src/index.ts` — generated index (will be rewritten)
- `/packages/python-sdk/src/superserve/` — all generated Python code (will be rewritten)
- `.github/workflows/fern-generate.yml` — Fern regeneration workflow
- `.github/workflows/docs.yml` — Fern docs publish workflow

### Files to modify:
- Root `package.json` — remove `generate*`, `docs:*` scripts; remove `fern-api` devDependency
- `turbo.json` — remove `generate` task
- `.gitignore` — remove `fern/openapi.yaml` entry
- `.github/workflows/release.yml` — keep but remove any Fern-specific steps

### Files to preserve:
- `packages/sdk/package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`
- `packages/python-sdk/pyproject.toml`, `README.md`, `package.json`

---

## 5. Mintlify Docs Restoration

### Approach

Restore the Mintlify config from commit `afb2781` as a starting point, then update:

1. **Restore `docs/docs.json`** from commit `afb2781` (theme "maple", dual logos, tabbed nav)
2. **Update navigation** to match current product + new SDK API surface
3. **Rewrite SDK reference pages** to document the new hand-crafted SDK
4. **Update quickstart** to use new SDK API (`Sandbox.create()` pattern)
5. **Keep PostHog integration** (key: `phc_gjpDKKKQJAnkxkqLrPGrAhoariKsaHNuTpI5rVhkYre`)

### Planned navigation structure

```
Documentation tab:
  Get Started:
    - Introduction
    - Quickstart
  Core Concepts:
    - Sandboxes
    - Execution
    - File System
    - Networking
    - Persistence (Pause/Resume)
  Frameworks:
    - Claude Agent SDK
    - OpenAI Agents SDK
    - LangChain
    - Mastra
    - Pydantic AI
    - Agno

SDK Reference tab:
  TypeScript:
    - Sandbox
    - Commands
    - Files
    - Types & Errors
  Python:
    - Sandbox
    - Commands
    - Files
    - Types & Errors
  API Reference:
    - Authentication
    - Sandboxes
    - Execution
    - Files
```

### Scripts

```json
{
  "docs:dev": "mintlify dev --dir docs",
  "docs:build": "mintlify build --dir docs"
}
```

Add `mintlify` as a devDependency at root.

---

## 6. E2E Tests

Update existing e2e tests (`tests/sdk-e2e-ts/`, `tests/sdk-e2e-py/`) to use the new SDK API:

```typescript
// Before (generated SDK)
const client = new SuperserveClient({ apiKey: "..." })
const sandbox = await client.sandboxes.create({ name: "test" })
await client.exec.execCommand(sandbox.id, { command: "echo hi" })

// After (hand-crafted SDK)
const sandbox = await Sandbox.create({ name: "test", apiKey: "..." })
const result = await sandbox.commands.run("echo hi")
```

---

## 7. Future Extensibility

The architecture accommodates these additions without breaking changes:

- **Snapshots:** `sandbox.createSnapshot()`, `Sandbox.listSnapshots()`, `Sandbox.deleteSnapshot(id)` — new methods on Sandbox class
- **Code execution:** `sandbox.code` sub-module — `sandbox.code.run("print('hello')", { language: "python" })`
- **Templates / method chaining:** `Template` builder class — `Template().fromImage("ubuntu:24.04").runCmd("apt install -y curl").build("my-template")`
- **File list/exists/remove:** extend `sandbox.files` sub-module
- **Sessions / persistent processes:** extend `sandbox.commands` with session management

Each addition is either a new sub-module property or new methods on existing classes — no restructuring needed.
