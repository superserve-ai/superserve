# MCP Server Launch Runbook

**Status:** 2026-06-23. The server (stdio + hosted Tier 1) is built and in **PR #234**; the hosted endpoint is **live at `https://mcp.superserve.ai`**; the npm package is **not yet published**. This runbook is the launch-day checklist for getting `@superserve/mcp` published, listed, tested, and announced.

**Related:** `spec/2026-06-18-mcp-server-design.md` (stdio server), `spec/2026-06-23-mcp-tier1-hosted.md` (hosted server). All directory/registry/client facts below were web-researched and adversarially verified on 2026-06-23.

---

## 0. Canonical metadata (reuse verbatim across every listing)

| Field               | Value                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package         | `@superserve/mcp`                                                                                                                                                                                                     |
| Registry name (MCP) | `io.github.superserve-ai/mcp`                                                                                                                                                                                         |
| Display name        | Superserve                                                                                                                                                                                                            |
| Tagline             | Create, run, and manage Firecracker microVM sandboxes from any MCP client.                                                                                                                                            |
| Short description   | MCP server for Superserve sandboxes — create sandboxes, run commands, and read/write files in isolated Firecracker microVMs. Works locally over stdio (`npx`) or via the hosted `https://mcp.superserve.ai` endpoint. |
| Categories          | Code Execution · Sandboxes · Developer Tools · Cloud                                                                                                                                                                  |
| Keywords            | sandbox, code-execution, firecracker, microvm, agents, ai, mcp                                                                                                                                                        |
| Repo                | `https://github.com/superserve-ai/superserve` (subfolder `packages/mcp`)                                                                                                                                              |
| Website             | `https://superserve.ai`                                                                                                                                                                                               |
| Docs                | `https://docs.superserve.ai/integrations/mcp`                                                                                                                                                                         |
| License             | Apache-2.0                                                                                                                                                                                                            |
| Local install       | `npx -y @superserve/mcp` · env `SUPERSERVE_API_KEY` (`ss_live_…`)                                                                                                                                                     |
| Hosted              | `https://mcp.superserve.ai` · `Authorization: Bearer ss_live_…` (Streamable HTTP, stateless, bearer-only — no OAuth in v1)                                                                                            |
| Tools (10)          | `sandbox_create`, `sandbox_list`, `sandbox_info`, `sandbox_exec`, `sandbox_files_read`, `sandbox_files_write`, `sandbox_files_list`, `sandbox_pause`, `sandbox_resume`, `sandbox_kill`                                |

---

## 1. Go-live sequence (ordered)

- [x] **A. Subdomain.** `mcp.superserve.ai` added to the `apps/mcp` Vercel project + CNAME at the DNS provider. **Verified live** (`/health` → 200, unauth `POST /` → 401 `WWW-Authenticate: Bearer realm="superserve-mcp"`).
- [ ] **B. Merge PR #234 → `main`.** On merge Vercel auto-builds the production deploy of `apps/mcp`; the custom domain follows it. No extra wiring.
- [ ] **C. npm publish** (see §2). Tag `mcp-v0.1.0` on `main` → `.github/workflows/mcp-publish.yml` runs `npm publish --provenance` then publishes to the MCP registry.
- [ ] **D. Official MCP registry** — handled by the same workflow (§2). One record carries both the npx package and the hosted remote.
- [ ] **E. Directory submissions** (see §3) — most accept the hosted URL / repo and are **not** blocked by npm.
- [ ] **F. Client testing** (see §4) across Claude Code / Cursor / VS Code / Messages API / inspectors.
- [ ] **G. Announce** — blog post + X thread (drafts in `.context/mcp-launch/`).

---

## 2. npm + official registry publish

**Mechanism (built):** `.github/workflows/mcp-publish.yml`, triggered by a `mcp-v*` tag. It version-stamps `package.json` + `server.json` from the tag, pins `@superserve/sdk` to the **latest published** npm version (the SDK is an external runtime dep; the workspace may be ahead of npm), builds, `npm publish --access public --provenance`, then `mcp-publisher validate` → `login github-oidc` → `publish`.

**Prerequisites / risks:**

1. **NPM*TOKEN must be able to create a \_new* package under `@superserve`.** The secret is wired (same one `cli-publish.yml` uses), but creating a brand-new package is a different permission than versioning an existing one. If it's a granular token scoped to only `@superserve/sdk` + `@superserve/cli`, it **cannot** create `@superserve/mcp` → first `npm publish` 403s. Mitigation: an org owner does **one** manual `npm publish --access public` from `packages/mcp`, then CI handles every version after. Confirm token type with `nirnejak` / `amit_010` / `pavitrabhalla`.
2. **Public repo** — required for provenance + the `io.github.superserve-ai` OIDC namespace proof. ✅ confirmed `superserve-ai/superserve` is PUBLIC.
3. **Domain live before registry publish** — `server.json` `remotes[].url` is `https://mcp.superserve.ai`; the registry expects it reachable. ✅ live.
4. **`mcp-publisher` schema bugs** — the workflow runs `mcp-publisher validate` first and installs the `latest` binary (known transformation/validation bugs in older versions, registry issues #525/#783).

**Verified registry facts** (schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`):

- Top-level required: `name`, `description`, `version` only. `$schema` and providing `packages`/`remotes` are conventions, not schema-enforced.
- `transport.type` is a strict enum: `stdio | streamable-http | sse` (note the hyphen in `streamable-http`).
- npm ownership is proven by `mcpName` in the published `package.json` matching the server.json `name` — already set to `io.github.superserve-ai/mcp`.
- `io.github.*` namespaces authenticate via GitHub (`login github` device flow locally, `login github-oidc` in CI). **No DNS TXT needed.** A custom-domain namespace (`ai.superserve/*`) is a future option via DNS auth.

---

## 3. Directory submission playbook (prioritized by leverage)

> Most directories accept the **hosted URL and/or GitHub repo** — only the `npx`/package paths wait on npm publish (§2). After the official-registry record exists, several aggregators ingest it automatically.

### Tier 0 — Official registry (one publish, widest downstream reach)

| Target                                                         | Mechanism                                                                                                    | Blocked by npm?                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Official MCP Registry** (`registry.modelcontextprotocol.io`) | `mcp-publisher publish` of `server.json` with **both** `packages[]` (npm) and `remotes[]` (streamable-http). | The **package** entry waits on npm; the **remote** entry does not. We publish both together post-tag (§2). |

### Tier 1 — Manual, high-traffic (mostly not blocked by npm)

| #   | Target                                                   | How to submit                                                                  | Inputs                                                                                  | Notes / gotchas                                                                                                                                                                                                  |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Glama** (`glama.ai/mcp`)                               | Web: "Add MCP Server" (repo) **and** "Connectors" form (remote URL)            | GitHub repo URL; for the connector, the `https://mcp.superserve.ai` Streamable-HTTP URL | Manual (no auto-crawl). GitHub-OAuth ownership (write/admin on repo). **Open risk:** does its connector health-probe tolerate our `GET → 405`, and how does it inject the bearer key? Test live before claiming. |
| 2   | **`mcp.directory`** `/submit`                            | Web form                                                                       | GitHub repo URL (req.); optional npm URL, description, email                            | Auto-detects from repo; also auto-discovers from the official registry; ~24h review. Has a "Best Remote MCP" section.                                                                                            |
| 3   | **awesome-mcp-servers** (`punkpeye/awesome-mcp-servers`) | GitHub PR to `README.md`                                                       | One alphabetical line: name → repo, 1-line desc, category, scope tags (☁️ cloud, 📇 TS) | Feeds Glama. Category: Code Execution / Coding Agents.                                                                                                                                                           |
| 4   | **PulseMCP** (`pulsemcp.com`)                            | Mostly **auto** (crawl + official-registry ingest); manual backup at `/submit` | usually none once in the official registry                                              | Has a remote-server filter. Expect auto-pickup after the registry record exists.                                                                                                                                 |
| 5   | **mcp.so**                                               | GitHub issue on `chatmcp/mcpso` (issue #1 is the canonical submit thread)      | server link, name, description, connection info                                         | ~20k servers. Field set is best-effort (site bot-gates).                                                                                                                                                         |

### Tier 2 — Higher-effort / narrower

| #   | Target                                              | How                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **Smithery** (`smithery.ai`)                        | CLI URL-publish: `smithery mcp publish https://mcp.superserve.ai -n superserve-ai/mcp`                                                                                 | We self-host, so use the "bring-your-own-hosting"/URL path — **no `smithery.yaml`, no npm needed**. **Open risk:** Smithery's gateway forwards a user-entered config field to a header but isn't documented to add a `Bearer ` prefix; our server requires `Authorization: Bearer <key>`. Either have users enter `Bearer ss_live_…`, relax the server to accept a bare key, or wait for OAuth. The `--config-schema` flag from earlier drafts was unverified — confirm the real config mechanism with Smithery before relying on it. |
| 7   | **Docker MCP Catalog** (`docker/mcp-registry`)      | GitHub PR adding `servers/<name>/server.yaml` (remote path, no Dockerfile)                                                                                             | Lands in Docker Desktop MCP Toolkit + Hub after Docker-team review. Apache-2.0 OK.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | **Cline MCP Marketplace** (`cline/mcp-marketplace`) | GitHub issue (submission template)                                                                                                                                     | Needs a 400×400 PNG logo + "Cline installs from README" — best **after** npm publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9   | **Cursor**                                          | **No submission queue.** Ship an "Add to Cursor" deeplink in our docs/site: `cursor://anysphere.cursor-deeplink/mcp/install?name=superserve&config=<base64 mcp.json>`. | Action is a button in our README, not a submission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Sequencing:** after merge + go-live you can do 1–7 + the Cursor deeplink **before npm publish** (repo/URL only). After npm publish, the official-registry package entry + Cline (8) complete the set; PulseMCP/mcp.so auto-refresh.

---

## 4. Client test matrix + smoke test

Hosted endpoint: `https://mcp.superserve.ai` — Streamable HTTP, **stateless**, JSON responses, **bearer-only (no OAuth/SSE in v1)**. Clients/curl **must** send `Accept: application/json, text/event-stream` or the SDK transport returns **406**. `POST` works at `/` and `/mcp`; `GET`/`DELETE` → 405.

| Client                                                             | Transport                            | How to add                                                                                                                                 | Bearer?   | Status          |
| ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------- |
| MCP Inspector (UI)                                                 | stdio                                | `npx @modelcontextprotocol/inspector -e SUPERSERVE_API_KEY=ss_live_… -- npx -y @superserve/mcp`                                            | n/a (env) | works           |
| MCP Inspector (UI/CLI)                                             | http                                 | URL + bearer in sidebar, or `--cli … --transport http --header "Authorization: Bearer ss_live_…"`                                          | yes       | works           |
| MCPJam (`npx @mcpjam/inspector@latest` / desktop / app.mcpjam.com) | http                                 | HTTP transport, URL, Bearer Token option **or** custom header `Authorization: Bearer ss_live_…`                                            | yes       | works           |
| Claude Code                                                        | http                                 | `claude mcp add --transport http superserve https://mcp.superserve.ai --header "Authorization: Bearer ss_live_…"`                          | yes       | works           |
| Claude Code                                                        | stdio                                | `claude mcp add superserve --env SUPERSERVE_API_KEY=ss_live_… -- npx -y @superserve/mcp`                                                   | n/a       | works           |
| Cursor                                                             | http (`.cursor/mcp.json`)            | `{ "mcpServers": { "superserve": { "url": "https://mcp.superserve.ai", "headers": { "Authorization": "Bearer ss_live_…" } } } }`           | yes       | works           |
| VS Code                                                            | http (`.vscode/mcp.json`)            | `type: "http"`, `url`, `headers.Authorization: "Bearer ${input:superserve-key}"` + `inputs[]` promptString                                 | yes       | works           |
| Anthropic Messages API                                             | url connector                        | `mcp_servers: [{ type: "url", url, name, authorization_token: "ss_live_…" }]`, beta header `mcp-client-2025-11-20`                         | yes\*     | works\*         |
| ChatGPT developer mode                                             | http connector                       | connector UI offers only OAuth / No-auth / Mixed — **no static-bearer field**                                                              | no        | **needs-oauth** |
| Claude.ai web / Claude Desktop Custom Connector UI                 | remote (OAuth)                       | OAuth-only connector flow                                                                                                                  | no        | **needs-oauth** |
| Claude Desktop                                                     | stdio (`claude_desktop_config.json`) | `{ "mcpServers": { "superserve": { "command": "npx", "args": ["-y","@superserve/mcp"], "env": { "SUPERSERVE_API_KEY": "ss_live_…" } } } }` | n/a       | works           |

\* Messages API `authorization_token` is documented for OAuth tokens; a plain `ss_live_` key is sent as the Bearer credential and should work — **verify end-to-end before claiming**.

### curl smoke test (raw JSON-RPC, bearer, stateless)

```bash
#!/usr/bin/env bash
set -euo pipefail
MCP_URL="https://mcp.superserve.ai"
MCP_TOKEN="ss_live_xxxxxxxxxxxxxxxx"
ACCEPT="application/json, text/event-stream"
call() { curl -sS -X POST "$MCP_URL" -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: $ACCEPT" -d "$1"; echo; }

curl -sS "$MCP_URL/health"; echo                                   # 0) {"status":"ok"}
call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-smoke","version":"1.0.0"}}}'
call '{"jsonrpc":"2.0","method":"notifications/initialized"}'
call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'              # expect 10 sandbox_* tools
CREATE=$(call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sandbox_create","arguments":{"name":"mcp-smoke"}}}')
SANDBOX_ID=$(printf '%s' "$CREATE" | grep -oE '[0-9a-f-]{36}' | head -1)
call "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"sandbox_exec\",\"arguments\":{\"sandbox_id\":\"$SANDBOX_ID\",\"command\":\"echo hi\"}}}"
call "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"sandbox_kill\",\"arguments\":{\"sandbox_id\":\"$SANDBOX_ID\"}}}"
```

(`sandbox_exec` arg is `command`, confirmed in `packages/mcp/src/tools/exec.ts`. Unauth → 401; `GET`/`DELETE` → 405.)

---

## 5. Open risks to confirm during launch

1. **NPM_TOKEN package-create scope** (§2.1) — only unknown that can fail the first publish.
2. **Glama connector health check** — does `GET → 405` pass, and how is the bearer key injected into its probe?
3. **Smithery bearer prefix** — gateway header transform vs. our `Bearer ` requirement.
4. **Messages API** — confirm a non-OAuth `ss_live_` works as `authorization_token`.
5. **ChatGPT dev mode / Claude.ai / Claude Desktop UI** — bearer unsupported (OAuth-only); revisit when the OAuth phase ships.
