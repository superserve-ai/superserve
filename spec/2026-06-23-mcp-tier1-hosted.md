# Tier 1 — Hosted Account-Level MCP Server

**Status:** Bearer v1 implemented (PR #234) — decisions locked 2026-06-23.
**Scope:** Tier 1 only. **Out of scope:** OAuth, dedicated MCP tokens, Tier 2 VM/SSH access (tracked separately).
**Related:** `spec/2026-06-18-mcp-server-design.md` (the stdio server this hosts).

## Goal

Let users connect to Superserve's MCP server **without installing anything locally** — a hosted,
network-reachable endpoint exposing the same account-level surface as `@superserve/mcp`: sandbox
lifecycle, command execution, and file upload/download.

## Locked decisions

| #   | Decision      | Choice                                                                        |
| --- | ------------- | ----------------------------------------------------------------------------- |
| 1   | Endpoint      | `https://mcp.superserve.ai`, co-located with / deployed alongside the console |
| 2   | v1 credential | Normal `ss_live_` API keys, passed as a bearer token (bring-your-own-key)     |
| 3   | Auth scope    | **Bearer only** for v1 — no OAuth                                             |
| 4   | Abuse control | Rely on existing backend per-team quota; no MCP-edge rate limiter             |

## Architecture

- **Transport:** Streamable HTTP (single endpoint, `POST` + optional `GET`/`DELETE`). No SSE.
- **State:** Stateless (no `Mcp-Session-Id`) — no session affinity, no Redis, scales horizontally / serverless.
- **Per-request flow:** read `Authorization: Bearer ss_live_…` → `createSdkClient({ apiKey })` →
  `createServer(client)` → handle the JSON-RPC request → respond. Nothing cached between requests.
- **Tools:** identical 10 tools, unchanged (`sandbox_create/list/info/pause/resume/kill`,
  `sandbox_exec`, `sandbox_files_read/write/list`). `sandbox_files_list` remains the `find`/`ls` shim.

## Auth & tenancy

- The inbound `ss_live_` key is the **exact** credential the stdio server uses today. The platform
  already scopes everything that key can do to its team (ownership, quota, data-plane token issuance).
  **Bearer-mode therefore inherits today's tenancy model with no new isolation code** — `sandbox_id`
  ownership is enforced by the backend exactly as for the SDK/CLI today.
- The hosted server only ever holds the **control-plane** key (per request, in memory); the
  per-sandbox data-plane access token stays inside the SDK and is never exposed to the model — same as stdio.
- **No new credential-exposure surface:** a leaked bearer key grants exactly what a leaked `ss_live_`
  key already grants via the SDK/CLI.

## Code changes (small)

Reused unchanged:

- `packages/mcp/src/server.ts` — `createServer(client)` is transport-agnostic.
- `packages/mcp/src/client.ts` — `createSdkClient({ apiKey, baseUrl })`.

New:

- An HTTP entrypoint that resolves the credential **per request** instead of from `process.env`
  (the stdio `index.ts` stays as-is for local use).

Recommended shape: `packages/mcp` exports a framework-agnostic HTTP handler built on the SDK's
stateless `StreamableHTTPServerTransport`, reusing `createServer(createSdkClient({ apiKey }))` per
request. The console exposes it at the `mcp.superserve.ai` subdomain via a thin route that extracts
the bearer token and delegates. (Alternative: Vercel's `mcp-handler` — Next-native, but its
callback-style tool registration differs from `createServer`, so it would need a small adapter.)

## Implementation (bearer v1, landed)

- `packages/mcp/src/lib/httpAuth.ts` — shared bearer extraction + per-request `buildServerForKey` (transport-agnostic).
- `packages/mcp/src/http.ts` — `handleMcpRequest(Request) => Response` web-standard handler (stateless `WebStandardStreamableHTTPServerTransport`, `enableJsonResponse`), exported as `@superserve/mcp/http` for the console route.
- `packages/mcp/src/httpServer.ts` — runnable Node server (`superserve-mcp-http` bin): `POST /` (or `/mcp`) + `GET /health`.
- Tools reused unchanged via `createServer` / `createSdkClient`. Auth/routing tests in `tests/http.test.ts`.

## Subdomain & endpoint

- `mcp.superserve.ai` → console deploy (add domain + host-based rewrite/middleware to the MCP route,
  or a dedicated route group). **[infra decision for console owner]**
- Serve the MCP endpoint at root `/` so the URL is just `https://mcp.superserve.ai`. `/mcp` is the
  alternative if a path is preferred.

## Client connection (bearer)

Works in clients that allow a custom header / bearer token:

- **Claude Code:** `claude mcp add --transport http superserve https://mcp.superserve.ai --header "Authorization: Bearer ss_live_…"`
- **Cursor / VS Code** (`mcp.json`): `{ "url": "https://mcp.superserve.ai", "headers": { "Authorization": "Bearer ss_live_…" } }` (VS Code: `"type": "http"`, prompt the key via `inputs`).
- **Anthropic Messages API connector:** `mcp_servers: [{ "type": "url", "name": "superserve", "url": "https://mcp.superserve.ai", "authorization_token": "ss_live_…" }]`
- **ChatGPT developer mode:** add a custom MCP server by URL.

**Not supported in v1 (needs OAuth):** Claude.ai web + Claude Desktop Custom Connector UI (no
custom-header field) and the Anthropic connectors directory. Deferred to a future OAuth phase.

## Security

- HTTPS only; bearer over TLS.
- **Never log or persist the API key** — scrub auth from any request logging (the stdio server writes
  diagnostics to stderr; the HTTP version must not echo the key).
- Reject missing/invalid bearer with `401` (+ `WWW-Authenticate`).
- CORS: MCP clients call server-side/native (Claude.ai/ChatGPT call from their backends), so no
  browser CORS is needed; handle `OPTIONS` only if a browser client is added.
- DoS/abuse: per decision #4, rely on backend per-team quota for sandbox creation + platform/CDN
  protection (Vercel/Cloudflare) for raw request floods. No app-level limiter in v1.

## Testing

- Reuse the existing in-memory harness (`packages/mcp/tests/`) for tool behavior — transport-independent.
- Add a live e2e: `POST` to the endpoint with a real `ss_live_` key; round-trip
  `sandbox_create` → `sandbox_exec` → `sandbox_kill`.

## Docs

- Extend `packages/mcp/README.md` with a "Hosted (remote)" section alongside the stdio instructions.
- Add hosted-connection notes to the `docs/integrations/mcp` Mintlify page.

## Out of scope / future

- **OAuth 2.1** (RFC 9728 metadata, Supabase-backed authorization server, token→team via the console's
  existing key-brokering) → unlocks Claude.ai/Desktop one-click + directory listing.
- **Dedicated, separately-revocable MCP token** (vs. raw `ss_live_` key).
- **Tier 2 — VM-level access via SSH** (SSH-over-`/exec/connect` WebSocket; Go backend / kathmandu).

## Open implementation questions (gate the scaffold)

1. **Integration approach:** `packages/mcp` HTTP handler + thin console route (recommended) vs. `mcp-handler`.
2. **Subdomain wiring** for `mcp.superserve.ai`: separate Vercel project vs. host rewrite/middleware.
3. **Endpoint path:** root `/` (recommended) vs. `/mcp`.
