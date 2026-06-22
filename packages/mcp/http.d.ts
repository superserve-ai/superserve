/**
 * Hand-written type declaration for the `@superserve/mcp/http` entry point.
 *
 * The package builds with `dts: false` — generating declarations would
 * type-check the entire MCP SDK + zod tool surface (multi-minute / OOM). This
 * entry's public surface is a single function, so its type is declared by hand.
 */

/**
 * Web-standard handler for the hosted Superserve MCP server. Pass a `fetch`
 * `Request` (e.g. from a Next.js route handler) and return its `Response`.
 * Authenticates per request via `Authorization: Bearer <SUPERSERVE_API_KEY>`.
 */
export declare function handleMcpRequest(request: Request): Promise<Response>
