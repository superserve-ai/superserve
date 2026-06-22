/**
 * Build the Superserve MCP server and register every tool.
 *
 * Exported separately from the stdio entry point so tests can drive it over an
 * in-memory transport with a fake {@link SandboxClient}.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { SandboxClient } from "./client.js"
import { SERVER_NAME, SERVER_VERSION } from "./constants.js"
import { registerExecTool } from "./tools/exec.js"
import { registerFileTools } from "./tools/files.js"
import { registerLifecycleTools } from "./tools/lifecycle.js"

export function createServer(client: SandboxClient): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })

  registerLifecycleTools(server, client)
  registerExecTool(server, client)
  registerFileTools(server, client)

  return server
}
