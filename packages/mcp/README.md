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
