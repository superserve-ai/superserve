/**
 * Hosted Superserve MCP endpoint (Tier 1) — served at the root of this app's
 * domain (e.g. https://mcp.superserve.ai). Delegates to the package's
 * Web-standard handler; auth is the per-request `Authorization: Bearer` key.
 */

import { handleMcpRequest } from "@superserve/mcp/http"

// Node serverless runtime; stateless, never cached.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request)
}

// GET (SSE probe) / DELETE (session end) are unused by the stateless server;
// the handler answers them with 405 so clients don't hold an idle stream open.
export function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request)
}

export function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request)
}
