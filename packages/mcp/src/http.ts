/**
 * Web-standard (`Request` → `Response`) HTTP handler for the hosted Superserve
 * MCP server — Tier 1 "hosted" deployment.
 *
 * Wire it into any `fetch`-style runtime. In the Next.js console it backs the
 * `mcp.superserve.ai` route:
 *
 * ```ts
 * import { handleMcpRequest } from "@superserve/mcp/http"
 * export const POST = (req: Request) => handleMcpRequest(req)
 * ```
 *
 * Stateless: a fresh MCP server + transport is built per request and torn down
 * after, so there is no session affinity and it scales horizontally. The
 * caller's API key is the bearer token; nothing is cached between requests.
 * Runs on Node 18+, Cloudflare Workers, Deno, and Bun.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

import {
  buildServerForKey,
  extractBearerToken,
  JSON_RPC,
  jsonRpcErrorBody,
  resolveBaseUrl,
  UNAUTHORIZED_MESSAGE,
} from "./lib/httpAuth.js"

function unauthorized(): Response {
  return new Response(
    jsonRpcErrorBody(JSON_RPC.UNAUTHORIZED, UNAUTHORIZED_MESSAGE),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="superserve-mcp"',
      },
    },
  )
}

function methodNotAllowed(): Response {
  return new Response(
    jsonRpcErrorBody(
      JSON_RPC.SERVER_ERROR,
      "Method not allowed. Use POST for MCP requests.",
    ),
    {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    },
  )
}

/**
 * Handle one MCP request. Only `POST` carries JSON-RPC; `GET` / `DELETE` (SSE
 * stream / session end) are unused by this stateless server and answered with
 * 405 so clients do not hold an idle stream open.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed()

  const apiKey = extractBearerToken(request.headers.get("authorization"))
  if (!apiKey) return unauthorized()

  const server = buildServerForKey(apiKey, resolveBaseUrl())
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session affinity
    enableJsonResponse: true, // buffered JSON response, not a long-lived SSE stream
  })

  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    // Read the (buffered JSON) body before tearing down the per-request server.
    const body = await response.arrayBuffer()
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    })
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
