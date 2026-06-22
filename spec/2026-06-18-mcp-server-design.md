# Superserve MCP Server — Research & Design (SS-84)

> _Research + design doc for SS-84. Competitor facts below were produced by parallel web research and then **adversarially re-verified** — a second pass corrected several hallucinated tool names/packages (e.g. Daytona's fabricated "46 tools", Modal's non-existent official repo, Fly.io's wrong plural tool names) and stripped Superserve's own architecture where it had leaked into competitor rows. Trust the verdict-corrected facts; low-confidence/unverified items are hedged inline (see §8)._

## 1. Executive summary

- **An official MCP server is now table stakes for sandbox providers.** Of the 11 targets researched, the verdicts confirm official servers from E2B, Daytona, Cloudflare, Runloop, Blaxel, Replit, and Fly.io; community-only for Modal, Northflank, and CodeSandbox; none for Vercel Sandbox. Superserve is currently in the minority _without_ one — SS-84 closes a real competitive gap.
- **The winning shape is a small, fine-grained, snake_case toolset with explicit per-call sandbox targeting, shipped over stdio and run via `npx`.** Cloudflare (7 tools), Daytona (12 _real_ tools, snake_case, per-call `id`), and Runloop (10 tools, per-call `devbox_id`) are the closest analogues to what we should build. Copy their granularity and their per-call ID model.
- **Avoid the two failure modes the research exposed.** (1) The single mega-tool (`run_code` only, like E2B/modal-mcp-toolbox) is too coarse for a file+exec product and the SS-84 acceptance criteria explicitly demand `files.read/write/list`. (2) The implicit "session-scoped, no sandbox id" model (Replit's _claimed_ design, Blaxel per-sandbox endpoints) is more surprising for agents and harder to map onto Superserve's `Sandbox.connect(id)` primitive — and note the verdict **refuted** the claim that Replit lacks targeting (it actually takes a required `replId`). Explicit IDs won.
- **Auth: a single `SUPERSERVE_API_KEY` env var over stdio is the correct v1 choice** — it matches Runloop (`RUNLOOP_API_KEY`), E2B (`E2B_API_KEY`), Blaxel (`BL_API_KEY`), and the MCP spec's local-stdio guidance. OAuth 2.1 (Cloudflare/Replit) belongs to a _remote hosted_ transport, which we defer to v2.
- **Headline recommendation:** ship `@superserve/mcp` at `packages/mcp` — a stdio MCP server built on `@modelcontextprotocol/sdk` + zod that **wraps the existing `@superserve/sdk`** (so the per-sandbox data-plane access token never leaves the process), exposing 10 fine-grained tools (`sandbox_create`, `sandbox_list`, `sandbox_info`, `sandbox_exec`, `sandbox_files_read`, `sandbox_files_write`, `sandbox_files_list`, `sandbox_pause`, `sandbox_resume`, `sandbox_kill`) with per-call `sandbox_id` and transparent auto-resume-on-exec. The one real engineering decision is `files.list`, which the SDK does not yet support — solve it via `commands.run("ls -la …")` for v1 and add a data-plane endpoint in parallel.

## 2. Landscape: competitor MCP servers

| Provider                            | MCP server?             | Package / install                                                                                                                | Transport(s)                                            | Auth                                                                        | Sandbox targeting                                                                                                        | Tool count & granularity                                                                                                                     | Notes                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2B**                             | official (archived)     | `npx -y @e2b/mcp-server` (npm, **deprecated**); `uvx e2b-mcp-server` (PyPI); `mcp/e2b` (Docker)                                  | stdio; HTTP (gateway, Bearer)                           | `E2B_API_KEY` env; Bearer for HTTP gateway                                  | Single persistent sandbox per session (implicit)                                                                         | **1** tool (`run_code`) — mega-tool                                                                                                          | Repo **archived 2026-04-16**; npm pkg deprecated. Acts as a _gateway_ to 200+ Docker MCP tools, not a fine-grained sandbox API.                                                                                                                                                    |
| **Daytona**                         | official                | `daytona mcp init [claude\|cursor\|windsurf]` (bundled in CLI); SDK `@daytona/sdk` (npm), `daytona` (PyPI)                       | **stdio only**                                          | `daytona login` (CLI session in `~/.daytona`), **not** an API-key env var   | Per-call optional **`id`** (Sandbox ID); **no** name-based/fuzzy matching                                                | **12** tools, snake_case (`create_sandbox`, `execute_command`, `upload_file`, `download_file`, `list_files`, `git_clone`, `preview_link`, …) | Research's "46 tools / name-based fuzzy matching / RunCode vs RunCommand" was **fabricated** — verdict confirms 12 snake_case tools, plain-text results, ID-based. `@daytonaio/sdk` is **deprecated** → `@daytona/sdk`.                                                            |
| **Vercel Sandbox**                  | **none**                | `@vercel/sandbox` (npm, SDK only)                                                                                                | —                                                       | OIDC `VERCEL_OIDC_TOKEN` / access token                                     | n/a (SDK `getOrCreate({ name })`)                                                                                        | 0                                                                                                                                            | Compute primitive, **not** MCP. The separate `mcp.vercel.com` manages _projects_, not sandbox code. Instructive: a credible competitor chose to ship **no** sandbox MCP.                                                                                                           |
| **Modal**                           | community (no official) | `mcp4modal-sandbox` (PyPI, `MODAL_TOKEN_ID/SECRET`); `modal-mcp-toolbox` (`uvx`)                                                 | stdio; streamable-http                                  | Modal token env vars (community)                                            | Per-call sandbox id                                                                                                      | `mcp4modal_sandbox` = **11** tools (lifecycle + file I/O); `modal-mcp-toolbox` = 2 (`run_python_code_in_sandbox`, `generate_flux_image`)     | "Official 18-tool modal-labs server" was **refuted** — `github.com/modal-labs/modal-mcp` 404s. Modal has **no** sandbox "paused" state (that claim was contamination from _our_ model).                                                                                            |
| **Cloudflare**                      | official                | remote: `https://containers.mcp.cloudflare.com/mcp` via `npx mcp-remote <url>`; `@cloudflare/sandbox` (npm)                      | Streamable HTTP (`/mcp`); SSE (deprecating)             | **OAuth 2.1** (browser flow); no env var                                    | Per-call container; `container_initialize` restarts container                                                            | **7** tools (`container_initialize/ping/file_write/file_read/files_list/file_delete/exec`)                                                   | Cleanest minimal toolset to copy. Containers **ephemeral ~10 min**. `mcp-remote` is **unscoped** (not `@modelcontextprotocol/mcp-remote`, which 404s).                                                                                                                             |
| **Runloop**                         | official                | `npm i -g @runloop/rl-cli` → `rli mcp start`                                                                                     | stdio; HTTP/SSE                                         | `RUNLOOP_API_KEY` env                                                       | Per-call **`devbox_id`**; `create_devbox` returns new id                                                                 | **10** tools (`list/get/create_devbox`, `execute_command`, `shutdown/suspend/resume_devbox`, `list_blueprints/snapshots`, `create_snapshot`) | Closest lifecycle analogue to Superserve (suspend/resume = pause/resume). **No** file read/write tools — file ops go through `execute_command`. Note: research's "control/data plane = api.superserve.ai / boxd-{id}.sandbox" was **our** architecture leaking into Runloop's row. |
| **Northflank**                      | community               | hosted via Composio / Pipedream (`https://mcp.pipedream.net/v2`); SDK `@northflank/js-client`                                    | HTTP (Composio `--transport http`, **not** SSE)         | `X-API-Key: <COMPOSIO_API_KEY>` / `NORTHFLANK_API_TOKEN`                    | Per-call (named service `sandbox-{uuid}`)                                                                                | **21** tools — but **infra management** (projects/secrets/services), **not** code-exec/file I/O                                              | MCP tools can't run code; the SDK `exec` API is separate. Isolation is **Kata + Cloud Hypervisor (gVisor fallback)**, not Firecracker.                                                                                                                                             |
| **Blaxel**                          | official                | per-sandbox endpoint `https://<SANDBOX_BASE_URL>/mcp`; resource-mgmt: `https://api.blaxel.ai/v0/mcp` or `blaxel-mcp-server` (Go) | streamable HTTP (+stdio for Go binary)                  | `BL_API_KEY`+`BL_WORKSPACE`; `Authorization: Bearer` + `X-Blaxel-Workspace` | **Implicit** — per-sandbox MCP endpoint; session tokens via `fromSession()`                                              | **20** sandbox tools (`processExecute`, `fs*`, `codegen*`)                                                                                   | Two distinct surfaces: per-sandbox interaction tools vs a separate resource-mgmt server (whose sandbox tools are **placeholder/non-functional**). `waitForCompletion` capped at **60s**; `codegenReadFileRange` max 250 lines.                                                     |
| **Replit**                          | official                | `claude mcp add --transport http replit https://replit-mcp.com/server/mcp`                                                       | Streamable HTTP only                                    | **OAuth 2.1 + PKCE** (auto via client)                                      | Per-call **`replId`** (required on update/ask) — verdict **refuted** the "no targeting" claim                            | **3** tools (`create_app_from_prompt`, `update_app_using_prompt`, `ask_question`)                                                            | Coarse, agent-builder-flavored, not a general sandbox API. Beta. Community `NOVA-3951` (24 tools, cookie auth) vs `pranjalll-k` (**5** tools, OAuth — _not_ 24).                                                                                                                   |
| **Fly.io**                          | official                | built into `flyctl`: `fly mcp server` (brew/GitHub release; **not** npm)                                                         | stdio; SSE; Streaming HTTP                              | `FLY_ACCESS_TOKEN` env / `--access-token` / Bearer header                   | **Per-call `id`** supported — `fly-machine-exec` takes required `id` (verdict **refuted** the "implicit app-only" claim) | ~**33** tools, **singular** names (`fly-machine-list/run/create/stop/exec`, `fly-apps-*`, `fly-volumes-*`)                                   | Research's plural `fly-machines-*`, `fly-apps-info`, `fly-volumes-delete` were **wrong** (actual: singular, `fly-machine-*`, `fly-volumes-destroy`).                                                                                                                               |
| **MCP spec / registries** _(topic)_ | —                       | `@modelcontextprotocol/sdk` (+zod); `mcp-publisher` CLI; `server.json`                                                           | stdio (preferred); Streamable HTTP; HTTP+SSE deprecated | env/API key (local stdio); OAuth 2.1 (remote)                               | n/a                                                                                                                      | n/a                                                                                                                                          | Tool design: kebab-or-snake names, `readOnly/destructive/idempotent/openWorld` hints, `isError` for tool failures vs JSON-RPC for protocol errors, `resource_link` for large output. Publish to `registry.modelcontextprotocol.io` + crawled by Glama/Smithery/PulseMCP.           |

**Most instructive detail per provider:**

- **E2B** — proves the mega-`run_code` tool is _insufficient_ for a file+exec product; E2B compensates with a 200-tool gateway. Also a cautionary tale on maintenance: the official repo is archived and the npm package deprecated.
- **Daytona** — the closest "do this" template: **12 snake_case tools, plain-text results, optional per-call `id`**. Ignore the research's fabricated 46-tool/fuzzy-matching description; the verdict is the source of truth.
- **Vercel Sandbox** — a serious provider deliberately shipped **no** sandbox MCP, confirming this is a choice, not an inevitability; it validates differentiating Superserve _by_ shipping one.
- **Modal** — beware aggregator "Official" badges: the claimed official server's repo 404s. Verify packages against the registry, which we did for our own deps.
- **Cloudflare** — the **7-tool** minimal set (`initialize/ping/file_write/file_read/files_list/file_delete/exec`) is the cleanest naming/granularity reference; its OAuth-only model is the remote-transport pattern we defer.
- **Runloop** — lifecycle 1:1 with us (`suspend/resume_devbox` ≈ `pause/resume`), per-call `devbox_id`, and notably **no file tools** (everything via `execute_command`) — we can do better by exposing real file tools.
- **Northflank** — its 21 MCP tools are _infra management_ with **no** exec/file I/O, the opposite of what agents want from a sandbox; don't model after it.
- **Blaxel** — the implicit per-sandbox-endpoint model is elegant but couples targeting to connection URLs; harder to express as "one server, many sandboxes, pick per call," which is what agents and SS-84 want.
- **Replit** — even the "no-targeting" server actually takes a required `replId`; **per-call IDs are the universal pattern**, reinforcing our choice.
- **Fly.io** — names matter and research gets them wrong: confirm tool identifiers against source. Per-call `id` targeting (`fly-machine-exec`) is supported, again validating explicit IDs.

## 3. Best practices distilled

### (a) Tool design & granularity

- **Fine-grained, single-responsibility tools — not a mega-tool.** The MCP spec explicitly warns against "god tools with dozens of operation parameters." Cloudflare (7), Daytona (12), Runloop (10) all won with small dedicated tools; E2B's lone `run_code` is the anti-pattern for a file+exec product. SS-84 mandates discrete `files.read/write/list`, so granular is also required.
- **Naming convention: lowercase `snake_case`, namespaced by a `sandbox_` prefix.** Daytona (`create_sandbox`, `execute_command`), Cloudflare (`container_*`), Runloop (`*_devbox`), Modal community (`launch_sandbox`) all use snake*case. The spec notes names are case-sensitive and recommends a single consistent convention. A `sandbox*` prefix disambiguates in clients that flatten many servers' tools into one list.
- **Descriptions are written for the model, not marketing.** Spec: "clear, concise, model-readable; specify expected input format and output semantics." Each tool's one-liner should state what it does and what it returns (see §4.4 for the exact strings).
- **Use tool annotations as honest UX hints** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Read-only tools (`sandbox_list`, `sandbox_info`, `sandbox_files_read`, `sandbox_files_list`) set `readOnlyHint: true` so clients skip confirmation. `sandbox_kill` is `destructiveHint: true`. `sandbox_kill`/`sandbox_pause`/`sandbox_files_write` are `idempotentHint: true` (kill is idempotent in the SDK; write overwrites deterministically). All sandbox tools are `openWorldHint: true` (they touch a remote VM). **Annotations are untrusted hints, never access control.**
- **Structured output paired with a text fallback.** Spec: emit `structuredContent` (machine-readable) **alongside** a `TextContent` block, or older clients see nothing. For `sandbox_exec`, return human-readable text (truncated stdout/stderr + exit code) _and_ structured `{ stdout, stderr, exitCode, truncated }`.
- **Token-efficient / truncated results.** Exec output and file reads can be huge; every token counts against context. Truncate large stdout/stderr (keep head+tail, mark `truncated: true`, report original byte length). The spec's `resource_link` pattern (return a URI, lazy-load via `resources/read`) is the v2 upgrade for very large output; v1 uses inline truncation.
- **Output/preview links where the platform provides them.** Daytona ships `preview_link`; we have no public preview-URL primitive in the SDK surface, so we omit it in v1 (note as a future tool).

### (b) Sandbox targeting & session model

- **Per-call explicit `sandbox_id` is the dominant, least-surprising pattern.** Daytona (`id`), Runloop (`devbox_id`), Modal-community, Northflank, Fly.io (`fly-machine-exec id`), and even Replit (`replId`) all take a per-call identifier. Implicit/session-scoped (E2B, Blaxel) is the minority and maps poorly onto our `Sandbox.connect(id)` primitive. **Decision: per-call `sandbox_id` everywhere it applies.**
- **Pair targeting with discovery + creation tools** so an agent that doesn't yet have an id can `sandbox_create` or `sandbox_list` to obtain one — exactly Daytona's and Runloop's shape.
- **Auto-resume on exec removes a whole class of agent errors.** Superserve transparently resumes a paused sandbox before exec (per `CLAUDE.md` and the SDK). Agents should _never_ need to call `sandbox_resume` before `sandbox_exec` — we document this and keep `sandbox_resume` only for callers who want to warm a sandbox explicitly. (Modal's research wrongly attributed this behavior to Modal; it's genuinely **ours**.)
- **No auto-create-on-call.** E2B deliberately does _not_ auto-create. We follow suit: `sandbox_exec` against a missing id returns a clean `isError` "sandbox not found; call sandbox_create first," not a surprise new VM (which would burn quota and hit `too_many_sandboxes`).

### (c) Auth

- **For local stdio, a single env API key is correct and universal:** `E2B_API_KEY`, `RUNLOOP_API_KEY`, `BL_API_KEY`, `FLY_ACCESS_TOKEN`. We use **`SUPERSERVE_API_KEY`** (already the SDK's variable; prefix `ss_live_`). Validate presence at startup; fail fast with an actionable message.
- **OAuth 2.1 is for _remote hosted_ servers** (Cloudflare, Replit). It's overkill and impossible for a local subprocess. Defer to a v2 hosted transport.
- **Never expose the data-plane access token.** The SDK manages the per-sandbox token internally and rotates it on `resume()`; the MCP server must only ever pass the _control-plane_ `SUPERSERVE_API_KEY` and let the SDK handle data-plane auth. The spec is explicit: never leak credentials in tool output or errors.

### (d) Transport

- **stdio is the default and the spec's preferred transport for local subprocess servers** — every install snippet in §6 uses it. Daytona is stdio-only; Runloop/Fly default to stdio. Ship stdio first.
- **Streamable HTTP is the remote/multi-tenant transport** (Cloudflare, Replit, Blaxel). Defer; design tools to be stateless (per-call `sandbox_id`, no server-side session) so an HTTP transport drops in cleanly later.
- **HTTP+SSE is deprecated** (replaced by Streamable HTTP, 2025-03-26). Do not build on it.

### (e) Distribution & registries

- **Zero-install via `npx -y @superserve/mcp` is the ecosystem norm** for TS/JS servers (uvx for Python). Clients launch the bin on demand; no global install.
- **Publish metadata to the official registry** (`registry.modelcontextprotocol.io`) via a `server.json` (reverse-DNS `name`, e.g. `ai.superserve/mcp`, with an `mcpName` field in `package.json` matching it) using the `mcp-publisher` CLI. The registry hosts _metadata_; the artifact lives on npm.
- **Discovery directories crawl automatically** after registry publish (Glama 37k+, Smithery, PulseMCP, mcp.so), typically 24–48h. Submit explicitly to **Glama** (SS-84 calls it out) and optionally a **Docker MCP Catalog** image for the container crowd.

### (f) Client install ergonomics

- **One canonical config block per client**, all `npx -y @superserve/mcp` + `SUPERSERVE_API_KEY` in `env`. Provide a `claude mcp add` one-liner (Claude Code), a `claude_desktop_config.json` block (Claude Desktop), `.cursor/mcp.json`, `.vscode/mcp.json`, and Windsurf — exactly the surfaces the registries-topic research documents. Env vars in these configs are **not** inherited from the shell, so they must be set explicitly in the `env` object.

## 4. Recommended design for @superserve/mcp

### 4.1 Package & stack

- **Location:** `packages/mcp`, published as **`@superserve/mcp`** (Apache-2.0, ESM, TS strict), alongside the existing `@superserve/sdk` and `@superserve/cli`. Built and tested through the existing **Bun workspaces + Turborepo** pipeline (`turbo run build/lint/typecheck/test --filter=@superserve/mcp`), linted/formatted with the root **oxlint/oxfmt** configs.
- **Dependencies:**
  - `@modelcontextprotocol/sdk` — `McpServer`, `registerTool`, stdio transport.
  - `@superserve/sdk` (workspace dep) — the single source of truth for all platform calls; the MCP server is a thin adapter.
  - `zod` (v4, peer of the MCP SDK) — input schemas.
  - No other runtime deps (mirrors the SDK's zero-dep ethos; `@superserve/sdk` already uses native `fetch`).
- **Bin / npx entry:** `package.json` `"bin": { "superserve-mcp": "./dist/index.js" }` with a `#!/usr/bin/env node` shebang; `"mcpName": "ai.superserve/mcp"`. Entry constructs the `McpServer`, registers tools, connects a `StdioServerTransport`.
- **Transport:** **stdio first.** Architect tools to be stateless (per-call `sandbox_id`, no in-process session map beyond a small SDK-instance cache keyed by id) so a Streamable HTTP transport is a later, additive change.

### 4.2 Auth & configuration

- **Env:** `SUPERSERVE_API_KEY` (required), `SUPERSERVE_BASE_URL` (optional, default `https://api.superserve.ai`). These are the SDK's own variables — no new config surface.
- **Startup validation:** on launch, if `SUPERSERVE_API_KEY` is missing or doesn't start with `ss_live_`, write a clear message to **stderr** (never stdout — stdout is JSON-RPC) and exit non-zero. This is the spec's "validate presence at startup" rule.
- **Token isolation:** the server instantiates the SDK once with the API key and reuses `Sandbox.connect(id)` / `Sandbox.create(...)`. The SDK injects the data-plane access token into `sandbox.files`/`sandbox.commands` internally and rotates it on resume. **The MCP server never reads, logs, or returns the access token.** Only the control-plane `X-API-Key` (from the env var) is ever in our hands.

### 4.3 Sandbox targeting model

**Chosen model: per-call `sandbox_id` argument, plus create/list/info tools, with transparent auto-resume on exec/file ops.** Justification:

- It's the dominant industry pattern (Daytona, Runloop, Fly, Replit) and the **least surprising for agents** — a tool call is self-contained, no hidden "current sandbox" state to get out of sync, which matters across multi-turn agent loops and parallel tool calls.
- It maps **directly** onto the SDK: `sandbox_id` → `Sandbox.connect(sandbox_id)` (which activates/auto-resumes and rotates the token), then call the relevant sub-module. No invented primitives.
- It keeps the server **stateless**, which is what the 2026 MCP direction (and a future HTTP transport) wants.

**Resolving "which sandbox":**

- An agent with no id calls **`sandbox_create`** (returns the new `id` + `name`) or **`sandbox_list`** (browse existing, optionally filtered by `metadata`). Both surface the id the agent then threads into subsequent calls.
- **Auto-resume:** `sandbox_exec`, `sandbox_files_*` all work on a `paused` sandbox because the platform transparently resumes before exec, and `Sandbox.connect` activates on connect. The tool descriptions explicitly tell the agent it does **not** need to resume first. `sandbox_resume` exists only as an explicit warm-up affordance.
- **Missing/invalid id:** SDK throws `NotFoundError` → mapped to `isError` with "Sandbox `<id>` not found. Use sandbox_list to see existing sandboxes or sandbox_create to make one." No silent auto-create.

### 4.4 Tool catalog (v1 deliverable)

Namespacing convention: **`sandbox_<verb>`** / **`sandbox_files_<verb>`**, lowercase snake_case. All tools are `openWorldHint: true` (remote VM). Output is `structuredContent` + a `TextContent` fallback.

| Tool                  | SDK call                                                                                       | Description (what the agent sees)                                                                                                                          | Input params                                                                                                                                                            | Output shape                                          | Annotations                                               |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `sandbox_create`      | `Sandbox.create({ name, fromTemplate?, fromSnapshot?, timeoutSeconds?, metadata?, envVars? })` | "Create a new Superserve sandbox (a Firecracker microVM). Returns the sandbox id to use in subsequent tool calls."                                         | `name: string?`, `from_template: string?`, `from_snapshot: string?`, `timeout_seconds: number?`, `metadata: record<string,string>?`, `env_vars: record<string,string>?` | `{ id, name, status, metadata }`                      | readOnly:false, destructive:false, idempotent:false       |
| `sandbox_list`        | `Sandbox.list({ metadata? })`                                                                  | "List your sandboxes (active and paused), optionally filtered by metadata. Returns ids, names, and statuses."                                              | `metadata: record<string,string>?`                                                                                                                                      | `{ sandboxes: [{ id, name, status, metadata }] }`     | readOnly:**true**, idempotent:true                        |
| `sandbox_info`        | `Sandbox.connect(id)` → `getInfo()`                                                            | "Get current details (status, metadata, timeout) for one sandbox by id."                                                                                   | `sandbox_id: string` (**required**)                                                                                                                                     | `SandboxInfo` (id, name, status, metadata, …)         | readOnly:**true**, idempotent:true                        |
| `sandbox_exec`        | `Sandbox.connect(id)` → `commands.run(cmd, { cwd?, env?, timeoutMs? })`                        | "Run a shell command in a sandbox and return stdout, stderr, and exit code. Paused sandboxes are resumed automatically — you do NOT need to resume first." | `sandbox_id: string` (**required**), `command: string` (**required**), `cwd: string?`, `env: record<string,string>?`, `timeout_ms: number?`                             | `{ stdout, stderr, exitCode, truncated }`             | readOnly:false, idempotent:false                          |
| `sandbox_files_read`  | `Sandbox.connect(id)` → `files.read(path)` / `readText(path)`                                  | "Read a file from a sandbox. Absolute path required. Returns UTF-8 text, or base64 when binary/over the size limit."                                       | `sandbox_id: string` (**required**), `path: string` (**required, absolute**), `encoding: "text"\|"base64"?` (default `text`)                                            | `{ path, content, encoding, bytes, truncated }`       | readOnly:**true**, idempotent:true                        |
| `sandbox_files_write` | `Sandbox.connect(id)` → `files.write(path, content)`                                           | "Write a file to a sandbox, creating or overwriting it. Absolute path required. Pass base64 for binary content."                                           | `sandbox_id: string` (**required**), `path: string` (**required, absolute**), `content: string` (**required**), `encoding: "text"\|"base64"?` (default `text`)          | `{ path, bytes }`                                     | readOnly:false, idempotent:**true**                       |
| `sandbox_files_list`  | `commands.run("ls -la …")` (see plan below)                                                    | "List directory contents in a sandbox. Absolute path required. Returns name, type, size, and mtime per entry."                                             | `sandbox_id: string` (**required**), `path: string` (**required, absolute**)                                                                                            | `{ path, entries: [{ name, type, size, modified }] }` | readOnly:**true**, idempotent:true                        |
| `sandbox_pause`       | `Sandbox.connect(id)` → `pause()`                                                              | "Pause a sandbox to save resources. State is preserved; resume or just exec to wake it."                                                                   | `sandbox_id: string` (**required**)                                                                                                                                     | `{ id, status: "paused" }`                            | readOnly:false, idempotent:**true**                       |
| `sandbox_resume`      | `Sandbox.connect(id)` → `resume()`                                                             | "Explicitly resume a paused sandbox. Usually unnecessary — exec and file tools auto-resume."                                                               | `sandbox_id: string` (**required**)                                                                                                                                     | `{ id, status: "active" }`                            | readOnly:false, idempotent:**true**                       |
| `sandbox_kill`        | `Sandbox.killById(id)`                                                                         | "Permanently delete a sandbox and all its state. Irreversible."                                                                                            | `sandbox_id: string` (**required**)                                                                                                                                     | `{ id, deleted: true }`                               | readOnly:false, **destructive:true**, idempotent:**true** |

This covers SS-84's required set (`create`, `exec/run`, `files.read`, `files.write`, `files.list`, `pause`, `resume`, `kill`) plus `sandbox_list` and `sandbox_info`.

**`files.list` plan (the SDK gap).** The SDK's `Files` class exposes only `write`, `read`, `readText` — there is **no** `list`/`delete`/`mkdir` (verified in `packages/sdk/src/files.ts`). Two options:

- **(Recommended for v1) Implement `sandbox_files_list` via `commands.run`.** Run a deterministic listing and parse it into structured entries. Use `find`/`stat` for machine-parseable output rather than scraping `ls -l`, e.g.:
  ```
  find <path> -maxdepth 1 -mindepth 1 -printf '%y\t%s\t%TY-%Tm-%TdT%TH:%TM:%TS\t%f\n'
  ```
  (`%y` = type d/f/l, `%s` = size, ISO mtime, name) — tab-delimited, trivial to split, no JSON-in-shell quoting hazards. Fall back to `ls -la` if `find -printf` is unavailable in the base image. **Tradeoff:** zero SDK/platform change and ships now, but it's exec-based (slightly slower, depends on `find`/coreutils in the image, and inherits exec's timeout/truncation semantics). Mark this clearly in code as a shim.
- **(Parallel, preferred long-term) Add a data-plane `files.list(path)` endpoint to `@superserve/sdk`.** A first-class `GET …/files?path=` returning `{ entries: [...] }` is faster, image-independent, and lets `sandbox_files_list` become a thin pass-through. **Tradeoff:** requires backend + SDK work (cross-repo), so it can't gate SS-84. Recommendation: **ship the `find` shim in v1 and open a follow-up ticket to add `files.list` to the SDK/data plane**, then swap the implementation with no tool-schema change.

**Exec streaming & timeouts.** `commands.run` supports SSE streaming with `onStdout`/`onStderr` and a `timeoutMs` idle reset. For v1 the tool is **request/response** (no MCP-side streaming): we call `run` with a sane default `timeout_ms` (e.g. 60s, configurable per call), collect output, truncate, and return. We capture partial output on `TimeoutError` and return it with `isError` + a message. (Interactive `commands.spawn`/`CommandSession` is a v2 feature.)

**Binary & size handling for files.** `files.read` returns `Uint8Array`; `readText` returns `string`. The tool tries `readText` for `encoding: "text"` and base64-encodes the raw bytes for `encoding: "base64"`. Enforce a max inline size (e.g. 1 MiB); beyond it, truncate and set `truncated: true` (v2: return a `resource_link` instead). `files.write` decodes base64 when `encoding: "base64"`. **Path validation** (absolute, no `..`) is already enforced client-side by the SDK and raises `ValidationError`; we surface that as a clean `isError`.

### 4.5 Output & error design

- **Token-efficient exec output.** Cap stdout and stderr independently (e.g. 32 KiB each). When over cap, keep head + tail with a `… [N bytes truncated] …` marker, set `truncated: true`, and include the original byte length. **Always** include `exitCode` — it's the single most useful field for an agent deciding next steps.
- **Structured + text.** Every tool returns `structuredContent` (typed object above) and a concise `TextContent` rendering (e.g. exec → `exit 0\n<stdout head>`), satisfying the spec's backward-compat rule.
- **SDK typed errors → `isError` tool results (not JSON-RPC protocol errors).** Tool-level failures must be `isError: true` so the model can self-correct (spec). Mapping:
  | SDK error | `isError` message (actionable) |
  |---|---|
  | `AuthenticationError` (401/403) | "Authentication failed. Check SUPERSERVE*API_KEY (must start with `ss_live*`)." |
| `NotFoundError`(404) | "Sandbox`<id>`not found. Use sandbox_list or sandbox_create." |
|`ValidationError`(400) | echo the validation reason (e.g. "Path must be absolute and contain no '..').") |
|`ConflictError`(409) | "Sandbox is in a conflicting state (e.g. already deleted). Re-check with sandbox_info." |
|`RateLimitError`(429) | include the reason code:`too_many_sandboxes`→ "Sandbox quota reached; pause/kill one or retry later." |
|`TimeoutError`| "Command timed out after`<ms>`ms" + any partial captured output. |
| `ServerError`(5xx) /`BuildError` | "Superserve server error; safe to retry." |
- **Protocol errors stay JSON-RPC** (unknown tool, malformed args caught by zod) — handled by the MCP SDK automatically.
- **Never leak secrets.** Sanitize all error messages and outputs; the access token is never in scope (§4.2). Env values passed via `env_vars` must not be echoed back in tool output.

### 4.6 What to defer to v2

- **Secrets & providers** (`Secret.create`, `Provider.list`) → `sandbox_secret_*` tools.
- **Templates & snapshots** (`Template.create`, `fromSnapshot`/`fromTemplate` as their own management tools, `create_snapshot` à la Runloop).
- **Network log** (`getNetworkLog`) → `sandbox_network_log` (read-only).
- **Interactive sessions** — `commands.spawn` / full-duplex `CommandSession` (stdin/kill/wait), and MCP-side streaming of exec output.
- **First-class `files.delete` / `files.mkdir`** once the data-plane endpoints exist (v1 can do these via exec if needed, but they're out of SS-84 scope).
- **`update` / metadata mutation** tool, and **`preview_link`**-style port exposure if/when the platform offers public preview URLs.
- **Remote hosted Streamable HTTP transport with OAuth 2.1** (the Cloudflare/Replit model) for a managed, no-local-key option.

## 5. Distribution & registry plan

1. **npm publish `@superserve/mcp`.**
   - Add `packages/mcp` to the Bun workspace; build with the SDK's tsup/Turbo setup (ESM + shebang bin).
   - `package.json`: `"bin": { "superserve-mcp": "./dist/index.js" }`, `"mcpName": "ai.superserve/mcp"`, `"files": ["dist"]`, `"license": "Apache-2.0"`, keywords (`mcp`, `model-context-protocol`, `sandbox`, `firecracker`, `superserve`).
   - Publish public: `bunx turbo run build --filter=@superserve/mcp && cd packages/mcp && bun publish --access public`. Verify `npx -y @superserve/mcp` cold-starts.
2. **Official MCP registry** (`registry.modelcontextprotocol.io`).
   - Author `server.json` (schema 2025-12-11): `name: "ai.superserve/mcp"`, `description`, `repository`, `version`, and a `packages[]` entry with `registryType: "npm"`, `identifier: "@superserve/mcp"`, `version`, `transport: { type: "stdio" }`, and declared `environmentVariables: [{ name: "SUPERSERVE_API_KEY", isRequired: true, isSecret: true }, { name: "SUPERSERVE_BASE_URL", isRequired: false }]`.
   - The `mcpName` in `package.json` **must exactly equal** the `server.json` `name` or publish fails with a permission error.
   - Authenticate the namespace. `ai.superserve` is a custom domain → use the **DNS TXT challenge** (add a TXT record proving control of `superserve.ai`). Alternatively publish under `io.github.superserve-ai/mcp` and use **GitHub OAuth/OIDC** (zero DNS work; matches the existing `github.com/superserve-ai/superserve` org). **Recommendation: GitHub namespace for v1** (fastest path), migrate to the branded `ai.superserve/mcp` once DNS is set.
   - Install the `mcp-publisher` CLI (GitHub release/brew), `mcp-publisher login github`, `mcp-publisher publish`.
3. **Discovery directories.** After registry publish, **Glama / Smithery / PulseMCP / mcp.so** crawl within ~24–48h. Submit explicitly to **Glama** (SS-84 requirement) and add the listing to docs. Smithery optionally hosts a one-click install.
4. **Docker MCP Catalog (optional, v1.x).** Build a `mcp/superserve` image (`docker run -i --rm -e SUPERSERVE_API_KEY mcp/superserve`) and submit to `github.com/docker/mcp-registry` for the container audience — mirrors E2B's `mcp/e2b`.

## 6. Client install snippets

All use `npx -y @superserve/mcp` over stdio with `SUPERSERVE_API_KEY` in `env`.

**Claude Code** (CLI one-liner):

```bash
claude mcp add superserve \
  --env SUPERSERVE_API_KEY=ss_live_xxxxxxxxxxxxxxxx \
  -- npx -y @superserve/mcp
```

**Claude Desktop** — `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "superserve": {
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

**Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "superserve": {
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json` (uses `servers` + secure input prompt; requires VS Code 1.99+):

```json
{
  "inputs": [
    {
      "id": "superserve-key",
      "type": "promptString",
      "description": "Superserve API key",
      "password": true
    }
  ],
  "servers": {
    "superserve": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "${input:superserve-key}" }
    }
  }
}
```

Or one-shot: `code --add-mcp '{"name":"superserve","command":"npx","args":["-y","@superserve/mcp"],"env":{"SUPERSERVE_API_KEY":"ss_live_xxxx"}}'`

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "superserve": {
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

These belong on a new **`docs/integrations/mcp`** Mintlify page (add to `docs.json` nav), with a one-paragraph intro, the tool table from §4.4, and the snippets above. Use a secret-input pattern (like the VS Code `inputs` block) in copy to discourage pasting raw keys.

**Where it slots in the existing docs.** The "Integration Guides" tab already groups pages as _Coding Agents, Personal Agents, Managed Agents, Agent Harnesses, Virtual Filesystems_ (and the SS-84-named **Hermes** and **OpenClaw** already have pages under _Personal Agents_). Add MCP either as a new top-level group (`"group": "MCP"`, page `integrations/mcp`) or a dedicated page — a new group reads best since MCP is its own distribution channel, not one agent.

**Do not confuse with the Mintlify `contextual` options.** `docs.json` already lists `"mcp"` and `"add-mcp"` under `contextual.options` — that is Mintlify's built-in "copy this docs page as MCP context / add docs to your MCP client" feature. It is **unrelated** to the Superserve _sandbox_ MCP server this doc designs; the new page should document the sandbox MCP server and not lean on that built-in.

## 7. Testing plan

Three layers, mirroring the existing `tests/` + Vitest setup; the live layer gates on `SUPERSERVE_API_KEY` exactly like the current e2e suite (skips cleanly without it).

1. **Tool-schema unit tests (no credentials).** For every tool: assert the registered name, the zod input schema (required vs optional, types, that `path` rejects relative paths and `..`), the declared annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint` match §4.4), and the description string is non-empty. Assert error mapping: feed each SDK error type into the handler (SDK mocked) and assert the `isError` result + actionable message. Snapshot the full `tools/list` output to catch accidental tool drift.
2. **In-memory MCP client integration test (no credentials).** Use the MCP SDK's in-memory/linked transport: spin the server, connect a client, call `tools/list` (assert all 10 tools), then exercise each tool against a **mocked `@superserve/sdk`** — assert `sandbox_create` returns an id, `sandbox_exec` returns `{stdout,stderr,exitCode}` + text fallback, `sandbox_files_write`→`sandbox_files_read` round-trips, `sandbox_files_list` parses the `find` output into structured entries, and `sandbox_kill` is idempotent (second call still succeeds). Verifies wiring without a network.
3. **Live exec round-trip (gated on `SUPERSERVE_API_KEY`).** Real end-to-end: `sandbox_create` → `sandbox_exec("echo hello")` asserts `stdout` contains `hello` and `exitCode === 0` → `sandbox_files_write("/tmp/t.txt","hi")` → `sandbox_files_read` asserts `"hi"` → `sandbox_files_list("/tmp")` contains `t.txt` → `sandbox_pause` → `sandbox_exec` again (asserts **auto-resume** works on a paused box) → `sandbox_kill` in a `finally`. Run via `bunx turbo run e2e --filter=@superserve/mcp`.

**Mapping to SS-84 acceptance criteria:**

| Criterion                                                               | Covered by                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| One server exposing create/exec/files.read/write/list/pause/resume/kill | §4.4 catalog; layer-1 `tools/list` snapshot + layer-2 per-tool calls                                           |
| Auth via API key; per-call sandbox targeting                            | §4.2/§4.3; startup-validation unit test + per-call `sandbox_id` schema test                                    |
| Verified in ≥2 clients (Claude + Cursor)                                | §6 snippets; **manual smoke** in Claude Code/Desktop + Cursor (record in PR), backed by layer-2 in-memory test |
| Docs `integrations/mcp` page with install snippets                      | §6 + new Mintlify page                                                                                         |
| Published to npm + MCP registries (Glama)                               | §5 steps                                                                                                       |
| Tests for tool schemas + live exec round-trip                           | layers 1 and 3                                                                                                 |

## 8. Open questions & risks

- **`files.list` SDK gap (highest-priority).** The SDK has no `files.list` (confirmed in `packages/sdk/src/files.ts`). v1 ships the `find`-based exec shim (§4.4). **Risks:** depends on `find`/coreutils in the sandbox base image; inherits exec timeout/truncation; subtly different perf and error surface from a real endpoint. **Action:** ship the shim behind the stable `sandbox_files_list` schema and **open a follow-up to add a data-plane `files.list` to `@superserve/sdk`** so the implementation can swap with no tool-contract change. Confirm `find -printf` works on the default template image; if not, the `ls -la` fallback parsing must be hardened.
- **Registry namespace verification.** `ai.superserve/mcp` requires a DNS TXT record on `superserve.ai`; `io.github.superserve-ai/mcp` only needs GitHub auth. **Decision needed:** branded vs github namespace for v1 (recommend github first, migrate later).
- **`sandbox_create` quota behavior.** Agents may create sandboxes liberally and hit `RateLimitError(too_many_sandboxes)`. We return an actionable error, but should the docs nudge agents to `sandbox_list` and reuse first? Consider a default `timeout_seconds`/auto-pause so abandoned agent sandboxes don't accumulate.
- **Output truncation thresholds** (32 KiB stdout, 1 MiB file inline) are proposed, not validated against real agent workloads. May need tuning; the v2 `resource_link` path removes the ceiling entirely.
- **Per-call `Sandbox.connect` cost.** Each tool call does `connect(id)` (which can auto-resume + rotate token). For chatty agents this is fine, but we should cache the connected `Sandbox` instance per id within the process to avoid redundant resumes within a burst — without leaking the token or assuming any cross-call session.
- **Client "verified in ≥2 clients" is manual.** No automated cross-client harness exists; verification is a documented manual smoke test in the PR. Acceptable for v1, but flag that client config formats (esp. VS Code `servers` vs `mcpServers`, Cursor deeplink encoding) drift and may need periodic re-verification.
- **Research items left unverified (do not present as fact):** Modal's "official 18-tool server" (**refuted** — repo 404s; treat Modal as community-only); E2B/Cloudflare specific deprecation/removal **dates** (several were fabricated or misattributed per the verdicts — cite only "deprecated," not the dates); Fly.io's "experimental/beta as of June 2026" and Sprite "1–12s boot" (**unverifiable**); CodeSandbox/Modal claims about "transparent access-token rotation on resume" that the verdicts flagged as **leaked from Superserve's own model** — that behavior is genuinely _ours_, not theirs, so don't cite competitors for it.

---

**Relevant file paths:** SDK surface to wrap lives at `/Users/mohamedmorsi/conductor/workspaces/superserve/shanghai/packages/sdk/src/` (`Sandbox.ts`, `commands.ts`, `files.ts`, `errors.ts`, `index.ts`). New package goes at `/Users/mohamedmorsi/conductor/workspaces/superserve/shanghai/packages/mcp/`. Save this doc under `/Users/mohamedmorsi/conductor/workspaces/superserve/shanghai/spec/` (e.g. `2026-06-18-mcp-server-design.md`). Docs page: `/Users/mohamedmorsi/conductor/workspaces/superserve/shanghai/docs/integrations/mcp.mdx` (register in `docs/docs.json`).
