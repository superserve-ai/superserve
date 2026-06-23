# @superserve/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [Superserve](https://superserve.ai) sandboxes. Create, run commands in, and manage isolated Firecracker microVMs from any MCP client — Claude, Cursor, VS Code, Windsurf.

Runs locally over stdio via `npx`. Authenticates with your Superserve API key. Targets a sandbox per call by id.

## Install

Add to your MCP client and set `SUPERSERVE_API_KEY` in its `env` (clients do not inherit it from your shell). Create a key at [console.superserve.ai](https://console.superserve.ai).

**Claude Code:**

```bash
claude mcp add superserve \
  --env SUPERSERVE_API_KEY=ss_live_xxxxxxxxxxxxxxxx \
  -- npx -y @superserve/mcp
```

**Claude Desktop / Cursor / Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`, `mcp_config.json`):

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

**VS Code** (`.vscode/mcp.json`, prompts for the key):

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

## Hosted (remote)

A hosted instance runs at `https://mcp.superserve.ai` (Streamable HTTP) — no local install. Send your Superserve API key as a bearer token; the server is stateless and account-scoped (the key already maps to your team).

> Bearer auth works in Claude Code, Cursor, VS Code, and the Anthropic Messages API connector. Claude.ai, Claude Desktop's Custom Connector UI, and ChatGPT developer mode expect OAuth (no static-bearer field), which the hosted endpoint does not support yet.

**Claude Code:**

```bash
claude mcp add --transport http superserve https://mcp.superserve.ai \
  --header "Authorization: Bearer ss_live_xxxxxxxxxxxxxxxx"
```

**Cursor / VS Code** (`.cursor/mcp.json`, `.vscode/mcp.json`):

```json
{
  "servers": {
    "superserve": {
      "type": "http",
      "url": "https://mcp.superserve.ai",
      "headers": { "Authorization": "Bearer ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

### Running the hosted server

The same package ships the hosted server. Run it standalone (self-host / staging):

```bash
PORT=8080 SUPERSERVE_BASE_URL=https://api.superserve.ai \
  npx -y -p @superserve/mcp superserve-mcp-http
```

Or mount the Web-standard handler in any `fetch` runtime (e.g. a Next.js route handler):

```ts
import { handleMcpRequest } from "@superserve/mcp/http"

export const POST = (req: Request) => handleMcpRequest(req)
```

It serves the MCP endpoint at `/` (POST) and a `GET /health` liveness probe. Config: `PORT` (default `8080`), `SUPERSERVE_BASE_URL` (optional). The API key is read per request from the bearer header and never logged.

## Tools

| Tool                  | Description                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `sandbox_create`      | Create a sandbox; returns its `id`.                                                    |
| `sandbox_list`        | List sandboxes (active and paused), filterable by metadata.                            |
| `sandbox_info`        | Get a sandbox's status, resources, and metadata (read-only).                           |
| `sandbox_exec`        | Run a shell command; returns stdout, stderr, exit code. Auto-resumes a paused sandbox. |
| `sandbox_files_read`  | Read a file (UTF-8 text or base64).                                                    |
| `sandbox_files_write` | Create or overwrite a file.                                                            |
| `sandbox_files_list`  | List a directory.                                                                      |
| `sandbox_pause`       | Pause a sandbox (state preserved).                                                     |
| `sandbox_resume`      | Resume a paused sandbox (usually unnecessary — exec auto-resumes).                     |
| `sandbox_kill`        | Delete a sandbox.                                                                      |

All tools except `sandbox_create` and `sandbox_list` take a `sandbox_id`.

## Configuration

| Variable              | Required | Default                     |
| --------------------- | -------- | --------------------------- |
| `SUPERSERVE_API_KEY`  | Yes      | —                           |
| `SUPERSERVE_BASE_URL` | No       | `https://api.superserve.ai` |

## Development

```bash
bun install
bunx turbo run build     --filter=@superserve/mcp
bunx turbo run typecheck --filter=@superserve/mcp
bunx turbo run test      --filter=@superserve/mcp        # unit + in-memory integration (no credentials)
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/mcp   # live round-trip
```

The server is a thin adapter over [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk); the per-sandbox data-plane access token is managed by the SDK and never exposed to the model.

## License

Apache-2.0
