---
name: superserve
description: Run code in isolated Firecracker microVM sandboxes with the Superserve TypeScript SDK (@superserve/sdk), Python SDK (superserve), or CLI. Use when a task needs an isolated runtime, secure or ephemeral compute, running untrusted or LLM-generated code, a remote shell, file I/O on a remote box, custom container images via templates, network egress control, streaming command output, or sandbox lifecycle operations (create, pause, resume, kill).
---

# Superserve

## Overview

Superserve runs code in isolated cloud sandboxes backed by Firecracker microVMs.
Create a sandbox, run commands in it, read/write files, and pause/resume/kill it —
from TypeScript, Python, or the CLI.

Two planes exist but the SDK hides both: the **control plane** (`api.superserve.ai`,
authenticated with your API key) and the per-sandbox **data plane** (authenticated
with a rotating access token). You never build data-plane URLs or manage tokens —
the SDK does it.

## When this skill wins

- Running untrusted or LLM-generated code in isolation
- Ephemeral compute: spin up, run, tear down
- A remote shell / command runner with file I/O
- Workloads that pause cheaply and resume later with full state
- Giving an agent framework (Claude Agent SDK, OpenAI Agents SDK) a sandboxed `bash` tool

## Hand off elsewhere

- Long-running production hosting or web services → use a real deploy target
- GPU clusters / heavy model training → not a sandbox use case
- Plain LLM calls with no code execution → no sandbox needed

(To deploy a *hosted agent* rather than drive sandboxes programmatically, see the CLI section.)

## Before you start

1. **Install the SDK**
   - TypeScript: `npm install @superserve/sdk` (Node ≥ 18; bun/pnpm/yarn also work)
   - Python: `pip install superserve` (Python ≥ 3.9; uv/poetry also work)
2. **Set `SUPERSERVE_API_KEY`** (key prefix `ss_live_`) in the environment — get it
   from the Superserve console. With it set, `create()` needs no other config.
3. *(Optional)* Override the API base with `SUPERSERVE_BASE_URL` (default `https://api.superserve.ai`).

## Quickstart

Create a sandbox, run a command, read its output, write/read a file, then delete it.

```ts
import { Sandbox } from "@superserve/sdk"
// Reads SUPERSERVE_API_KEY from the environment.

const sandbox = await Sandbox.create({ name: "demo" }) // ready when create() resolves
try {
  const { stdout, exitCode } = await sandbox.commands.run("echo hello")
  console.log(stdout, exitCode) // "hello\n", 0

  await sandbox.files.write("/app/data.txt", "content")
  const text = await sandbox.files.readText("/app/data.txt")
  console.log(text) // "content"
} finally {
  await sandbox.kill() // no `await using`; always clean up explicitly
}
```

```python
from superserve import Sandbox  # reads SUPERSERVE_API_KEY from the environment

sandbox = Sandbox.create(name="demo")  # ready when create() returns
try:
    result = sandbox.commands.run("echo hello")
    print(result.stdout, result.exit_code)  # "hello\n", 0

    sandbox.files.write("/app/data.txt", "content")
    text = sandbox.files.read_text("/app/data.txt")
    print(text)  # "content"
finally:
    sandbox.kill()  # no context manager; always clean up explicitly
```

For async Python, use `AsyncSandbox` and `await` every call.

## Lifecycle

States: **active ↔ paused → deleted**. Two are long-lived; two are transient signals:

- `active` — running, compute billed. `paused` — state on disk, **no compute billed**.
- `resuming` — transient; a paused sandbox is being restored, retry shortly.
- `failed` — couldn't boot or resume; the entry persists until you `kill()` it.

Key behaviors:

- `create()` is **synchronous** — the sandbox is ready to use the moment it resolves.
- `pause()` checkpoints the full VM (memory, processes, filesystem); `resume()` restores it
  and processes pick up where they left off.
- **Exec auto-resumes.** Running a command or file op (or `connect()`) on a `paused`
  sandbox transparently resumes it first — you do **not** call `resume()` yourself.
- **`timeoutSeconds` / `timeout_seconds` caps active lifetime, then auto-*pauses*** —
  state is preserved, it is **not** deleted. (Bounded by an API-side upper limit.)
- `resume()` rotates the per-sandbox access token; the SDK re-injects it into
  `sandbox.files` for you — keep using the **same** object after resume.
- A sandbox **outlives the process that created it.** Persist `sandbox.id` and reconnect
  later with `Sandbox.connect(id)` (returns a fresh access token).
- `kill()` is **idempotent** (a 404 is swallowed). `pause()`/`resume()`/`kill()` return nothing.
- The instance's `status` and `metadata` are **read-only snapshots from construction**.
  Call `getInfo()` / `get_info()` for fresh server state.

## System specs & defaults

A sandbox **inherits its VM shape from its template** — there is **no `vcpu`, `memory`,
or `disk` argument on `create()`**. To change the shape, boot from (or build) a different
template. The default template `superserve/base` (`ubuntu:24.04`) is **1 vCPU · 1024 MiB
memory · 4096 MiB disk**.

| Shape field | Min | Max (platform ceiling) | Default |
|---|---|---|---|
| `vcpu` | 1 | 4 | 1 |
| `memoryMib` | 256 | 4096 | 1024 |
| `diskMib` | 1024 | 8192 | 4096 |

- **New teams are capped at 2 vCPU / 2048 MiB** — email support@superserve.ai to raise it.
- Heavier system templates (`superserve/python-ml`, `code-interpreter`, `claude-code`,
  `openclaw`, `hermes`) ship at 2 vCPU / 2048 MiB. See the full catalog in the docs.
- Live shape and timestamps (`vcpuCount`, `memoryMib`, `createdAt`, `network`) live on
  **`SandboxInfo`** (from `getInfo()` / `list()`), not on the sandbox instance.

## Common operations

| Task | TypeScript | Python (sync) | Returns / notes |
|---|---|---|---|
| Create | `Sandbox.create({ name })` | `Sandbox.create(name=...)` | `Sandbox`; opts: `timeoutSeconds`, `metadata`, `envVars`, `network`, `fromTemplate`, `fromSnapshot` (snapshot UUID) |
| Reconnect | `Sandbox.connect(id)` | `Sandbox.connect(id)` | `Sandbox`; auto-resumes if paused |
| List | `Sandbox.list({ metadata })` | `Sandbox.list(metadata=...)` | `SandboxInfo[]` (no live instance); metadata filters combine with AND |
| Delete by id | `Sandbox.killById(id)` | `Sandbox.kill_by_id(id)` | idempotent |
| Fresh info | `sandbox.getInfo()` | `sandbox.get_info()` | `SandboxInfo` |
| Pause | `sandbox.pause()` | `sandbox.pause()` | — |
| Resume | `sandbox.resume()` | `sandbox.resume()` | rotates access token |
| Delete | `sandbox.kill()` | `sandbox.kill()` | idempotent |
| Update | `sandbox.update({ metadata, network })` | `sandbox.update(metadata=..., network=...)` | patches tags / egress; **metadata is replaced, not merged — pass the full map** |
| Run command | `sandbox.commands.run(cmd, opts)` | `sandbox.commands.run(cmd, ...)` | `{ stdout, stderr, exitCode }` / `CommandResult`; opts: `cwd`, `env`, timeout |
| Stream output | `run(cmd, { onStdout, onStderr })` | `run(cmd, on_stdout=..., on_stderr=...)` | chunks via callbacks; result still holds full buffer |
| Interactive process | `sandbox.commands.spawn(cmd, opts)` | `AsyncSandbox(...).commands.spawn(...)` | full-duplex session (sync Python raises — use async) |
| Write file | `sandbox.files.write(path, content)` | `sandbox.files.write(path, content)` | parent dirs auto-created |
| Read bytes | `sandbox.files.read(path)` | `sandbox.files.read(path)` | `Uint8Array` / `bytes` |
| Read text | `sandbox.files.readText(path)` | `sandbox.files.read_text(path)` | UTF-8 string |

⚠️ **Unit footgun:** the command timeout is **`timeoutMs` (milliseconds) in TS** but
**`timeout_seconds` (seconds) in Python**. `run("…", { timeoutMs: 10000 })` ≈ `run("…", timeout_seconds=10)`.
Porting `60_000` straight into `timeout_seconds` is ~16.7 hours, not 60 seconds.

File paths must be **absolute** (start with `/`) and must not contain `..` segments.

## Streaming & interactive commands

`run()` returns once the command finishes. For long jobs, pass `onStdout` / `onStderr`
callbacks to watch output live — **the returned result still holds the complete buffer.**

```ts
const r = await sandbox.commands.run("npm run build", {
  onStdout: (data) => process.stdout.write(data),
  timeoutMs: 300_000,
})
console.log(`exited ${r.exitCode}`, r.stdout.length) // full stdout captured too
```

```python
import sys
r = sandbox.commands.run("npm run build",
    on_stdout=lambda data: sys.stdout.write(data), timeout_seconds=300)
print(f"exited {r.exit_code}", len(r.stdout))
```

Streaming uses an **idle timeout** that resets on each chunk (a chatty command never trips
it; a silent one still must finish in time). If the stream drops before the `finished`
event, `run()` **throws** — but the command keeps running in the sandbox, so reconnect with
`Sandbox.connect(id)` if you saved the ID.

Use **`spawn()`** when you need to send stdin, signal the process, or keep a REPL open. It
resolves once the process is *running* and hands back a session: `stdin.write(data)`,
`stdin.close()` (EOF), `kill(signal?)` (default `SIGTERM`), `wait()` (resolves on exit;
rejects if the socket drops first). `spawn()` is **async-only in Python** (`AsyncSandbox`;
sync raises and points you there) and needs **Node 22+** in TS (or a `ws` polyfill).

```ts
const session = await sandbox.commands.spawn("python -i", {
  onStdout: (data) => process.stdout.write(data),
})
session.stdin.write("print(2 + 2)\n")
session.stdin.close() // EOF, so the REPL exits
console.log((await session.wait()).exitCode)
```

```python
# spawn is async only → use AsyncSandbox; `async with` kills + closes on exit
async with await sandbox.commands.spawn("python -i",
    on_stdout=lambda data: print(data, end="")) as session:
    await session.stdin.write("print(2 + 2)\n")
    await session.stdin.close()  # EOF, so the REPL exits
    print((await session.wait()).exit_code)
```

## Templates — reusable base images

A **template** is a Linux filesystem snapshot (base image + build steps) that sandboxes
boot from. Use one to pre-install dependencies once and launch identically-configured
sandboxes in seconds, or to change the VM shape. Every sandbox boots from a template;
omit `fromTemplate` and you get `superserve/base`.

Flow: **`Template.create()` (queues an async build) → `waitUntilReady()` → `Sandbox.create({ fromTemplate })`.**

```ts
import { Template, Sandbox } from "@superserve/sdk"

const template = await Template.create({
  name: "my-python-env",
  from: "python:3.11",           // linux/amd64 OCI image; Alpine & distroless are rejected
  vcpu: 2,
  memoryMib: 2048,
  steps: [{ run: "pip install numpy pandas" }, { workdir: "/app" }],
}) // resolves once the build is QUEUED, not finished
await template.waitUntilReady()  // blocks until the build finishes (throws BuildError on failure)
const sandbox = await Sandbox.create({ name: "run-1", fromTemplate: template })
```

```python
from superserve import Template, Sandbox, RunStep, WorkdirStep

template = Template.create(
    name="my-python-env",
    from_="python:3.11",
    vcpu=2,
    memory_mib=2048,
    steps=[RunStep(run="pip install numpy pandas"), WorkdirStep(workdir="/app")],
)
template.wait_until_ready()
sandbox = Sandbox.create(name="run-1", from_template=template)
```

- **Build steps:** a list where each step sets **exactly one** of `run`, `env`
  (`{ key, value }`), `workdir`, or `user` (`{ name, sudo? }`). `env`/`workdir`/`user` also
  become runtime defaults (caller `envVars` / per-exec `cwd` override them). Optional
  `startCmd` (long-running process captured in the snapshot) and `readyCmd` (readiness probe,
  polled every 2s up to 10 min).
- `Template.create` / `rebuild` may raise **`RateLimitError`** (`too_many_builds` /
  `too_many_templates`); `waitUntilReady()` raises **`BuildError`** with a machine-readable
  `code` (`step_failed`, `image_pull_failed`, …) on build failure.
- `fromTemplate` accepts a `Template` instance, a name (`my-python-env`), or a UUID.
- Full surface (`rebuild`, `listBuilds`, `getBuild`, `cancelBuild`, `streamBuildLogs`, the
  system-template catalog, and every build-error code) is in the docs — link below.

## Authentication & environment

- Auth via **`SUPERSERVE_API_KEY`** (prefix `ss_live_`, scoped to one team). **Never hardcode it** —
  read it from the environment. Per-call override: `apiKey` (TS) / `api_key=` (Python).
- `SUPERSERVE_BASE_URL` overrides the control-plane URL (default `https://api.superserve.ai`).
- **Env vars:** `envVars` (TS) / `env_vars` (Python) on `create()` inject variables into
  **every** process; they **persist across `pause()`/`resume()`**. A per-command `env`
  overrides for that one call only. Values pass through **unmodified** — no shell expansion,
  so escape `$` yourself.
- **Cancellation/timeout:** TS — every network op accepts `signal` (`AbortSignal`);
  Python — pass `timeout` (seconds) to file ops, `timeout_seconds` to command ops.
- **Auto-retry:** GET/DELETE requests retry transient failures (429, 502/503/504,
  network) with exponential backoff + jitter. Creates and other mutations (POST/PATCH)
  do **not** auto-retry.

## Network egress control

By default a sandbox reaches any **public** IP; the platform **always** blocks private,
link-local, and loopback ranges (non-overridable). `network` rules only *narrow* egress —
ideal for the untrusted-code use case.

| Field | Accepts | Notes |
|---|---|---|
| `allowOut` / `allow_out` | CIDRs **+ domains** | Wildcards (`*.example.com`) match subdomains at any depth but **not the apex** — list both if you need it. |
| `denyOut` / `deny_out` | **CIDRs only** | `0.0.0.0/0` denies the whole internet; allow exceptions via `allowOut`. |

Allow rules win over deny on overlap, so the strict pattern is **deny-all + allowlist**.
Egress is editable live via `update({ network })`. **Never block `*.superserve.ai`** — it
breaks the SDK↔sandbox connection.

```ts
await Sandbox.create({
  name: "restricted",
  network: { allowOut: ["api.openai.com", "*.github.com", "140.82.112.0/20"], denyOut: ["0.0.0.0/0"] },
})
```

```python
from superserve import Sandbox, NetworkConfig

Sandbox.create(name="restricted", network=NetworkConfig(
    allow_out=["api.openai.com", "*.github.com", "140.82.112.0/20"], deny_out=["0.0.0.0/0"]))
```

## Error handling

Every SDK call throws a typed error extending `SandboxError`. Catch the base, or
narrow to a subclass. A **non-zero `exitCode` is a normal result, not a thrown error.**

| Error | Thrown when |
|---|---|
| `SandboxError` | Base class for all SDK errors (carries `statusCode`, `code`) |
| `AuthenticationError` | API key missing / invalid / forbidden (401/403) |
| `ValidationError` | Bad request or invalid arguments (400) |
| `NotFoundError` | Sandbox / template / resource does not exist (404) |
| `ConflictError` | Invalid state transition, e.g. an unsupported lifecycle change (409) |
| `TimeoutError` | A request timed out — **Python: `SandboxTimeoutError`** (avoids shadowing the builtin) |
| `RateLimitError` | Quota / rate limit exceeded (429); `code` names which limit (`too_many_builds`, `too_many_templates`, `too_many_sandboxes`) |
| `ServerError` | Platform error (500+) |
| `BuildError` | Template build failed (carries `buildId`, `templateId`, `code`) |

```ts
import { Sandbox, NotFoundError, AuthenticationError } from "@superserve/sdk"
try {
  const sandbox = await Sandbox.connect(id)
} catch (e) {
  if (e instanceof NotFoundError) { /* gone — create a fresh one */ }
  else if (e instanceof AuthenticationError) { /* fix SUPERSERVE_API_KEY */ }
  else throw e
}
```

## Gotchas & anti-patterns

**Gotchas**

- Don't call `resume()` before exec — a command/file op auto-resumes a paused sandbox.
- Check `exitCode`; the SDK only throws for transport/API failures, not command failures.
- Use `getInfo()` for current state — the instance `status`/`metadata` are stale snapshots.
- `update({ metadata })` **replaces** the whole map; omitted keys are dropped.
- No `vcpu`/`memory`/`disk` on `create()` — size the VM via the template.
- `Template.create()` returns when the build is *queued*; boot a sandbox only **after**
  `waitUntilReady()` resolves.
- Streaming `run()` uses an idle timeout (resets per chunk) and throws if the stream ends
  without a `finished` event; the command keeps running — reconnect via `connect(id)`.
- (Python) the sandbox holds a shared `httpx` client, closed on `kill()` — always
  `kill()` rather than just dropping the reference.

**Anti-patterns**

- ❌ Hardcoding the API key in source — read `SUPERSERVE_API_KEY` from the env.
- ❌ Building data-plane URLs (`boxd-{id}.sandbox.superserve.ai`) or handling access
  tokens by hand — the SDK does this.
- ❌ Relying on `await using` / a `with` block on the sandbox — there is none; `kill()` in a `finally`.
- ❌ Trusting `sandbox.status` after pause/resume — fetch `getInfo()`.
- ❌ Passing relative file paths — paths must be absolute.
- ❌ Denying `*.superserve.ai` in a network rule — it severs the SDK connection.

## Integrations — agent frameworks

Two patterns: an agent runs **inside** a sandbox (boot a ready-made system template such
as `superserve/claude-code`), or an agent **calls out** to a sandbox by exposing
`sandbox.commands.run` as a tool. For the second, the canonical wiring is a single `bash`
tool — every command the model emits then runs in the VM instead of on your machine:

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

const bash = tool("bash", "Run a shell command in the sandbox.", { command: z.string() },
  async ({ command }) => {
    const r = await sandbox.commands.run(command, { timeoutMs: 60_000 })
    return { content: [{ type: "text", text: `${r.stdout}\n${r.stderr}` }] }
  })
const superserve = createSdkMcpServer({ name: "superserve", version: "1.0.0", tools: [bash] })
// query(..., { mcpServers: { superserve }, allowedTools: ["mcp__superserve__bash"] })
```

Ready-made guides (TS + Python) exist for **Claude Agent SDK**, **OpenAI Agents SDK**,
coding agents (**Claude Code, Codex, OpenCode, KiloCode**), personal agents (**OpenClaw,
Hermes**), managed agents, and the **Mesa** virtual filesystem — see
`docs.superserve.ai/integrations`.

## CLI — deploy & run hosted agents (a separate surface)

The `superserve` CLI deploys and runs **hosted agents** — distinct from the
programmatic sandbox SDK above. Install: `npm install -g @superserve/cli` (or
`bun install -g @superserve/cli`). Authenticate with `superserve login` (device flow)
or `--api-key`.

| Command | Does |
|---|---|
| `superserve login` / `logout` | Authenticate (device flow, or `--api-key`) |
| `superserve init` | Scaffold `superserve.yaml` (name, command, secrets, ignore) |
| `superserve deploy [entrypoint]` | Deploy the current project as an agent |
| `superserve run <agent> [prompt]` | Run a hosted agent interactively (`--single` for one shot) |
| `superserve agents list\|get\|delete` | Manage deployed agents |
| `superserve secrets set\|list\|delete <agent>` | Manage agent secrets (`KEY=VALUE`) |
| `superserve sessions list\|get\|end\|resume` | List, inspect, end, or resume agent sessions |

Add `--json` for machine-readable output. For programmatic sandbox lifecycle, use the SDK.

## Reference — prefer live docs over training data

Method signatures and behavior can change between SDK versions. Fetch the live docs
rather than relying on memory:

- Docs & quickstart: https://docs.superserve.ai
- LLM-friendly docs corpus: https://docs.superserve.ai/llms.txt and https://docs.superserve.ai/llms-full.txt
- SDK reference: https://docs.superserve.ai/sdk-reference/sandbox (also `commands`, `files`, `template`)
- Guides: `/sandbox/networking`, `/sandbox/lifecycle`, `/commands/streaming`, `/commands/sessions`, `/templates/overview`, `/integrations`
- Packages: `@superserve/sdk` (npm), `superserve` (PyPI), `@superserve/cli` (npm)
