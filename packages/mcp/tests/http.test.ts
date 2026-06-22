import { describe, expect, it } from "vitest"

import { SERVER_NAME } from "../src/constants.js"
import { handleMcpRequest } from "../src/http.js"
import { extractBearerToken, resolveBaseUrl } from "../src/lib/httpAuth.js"

describe("extractBearerToken", () => {
  it("parses a Bearer token", () => {
    expect(extractBearerToken("Bearer ss_live_abc")).toBe("ss_live_abc")
  })
  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer ss_live_abc")).toBe("ss_live_abc")
  })
  it("trims surrounding whitespace", () => {
    expect(extractBearerToken("  Bearer   ss_live_abc  ")).toBe("ss_live_abc")
  })
  it("returns null when absent", () => {
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken("")).toBeNull()
  })
  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull()
  })
  it("returns null when the scheme carries no token", () => {
    expect(extractBearerToken("Bearer")).toBeNull()
    expect(extractBearerToken("Bearer   ")).toBeNull()
  })
})

describe("resolveBaseUrl", () => {
  it("returns the trimmed value", () => {
    expect(resolveBaseUrl({ SUPERSERVE_BASE_URL: " https://api.x " })).toBe(
      "https://api.x",
    )
  })
  it("returns undefined when empty or unset", () => {
    expect(resolveBaseUrl({})).toBeUndefined()
    expect(resolveBaseUrl({ SUPERSERVE_BASE_URL: "  " })).toBeUndefined()
  })
})

describe("handleMcpRequest", () => {
  const post = (headers: Record<string, string>, body: unknown): Request =>
    new Request("https://mcp.superserve.ai/", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })

  it("rejects a non-POST method with 405 + Allow: POST", async () => {
    const res = await handleMcpRequest(
      new Request("https://mcp.superserve.ai/", { method: "GET" }),
    )
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("rejects a missing bearer token with 401 + WWW-Authenticate", async () => {
    const res = await handleMcpRequest(
      post({}, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/SUPERSERVE_API_KEY/)
  })

  it("completes an MCP initialize handshake over HTTP (no network)", async () => {
    const res = await handleMcpRequest(
      post(
        {
          authorization: "Bearer ss_live_test",
          accept: "application/json, text/event-stream",
        },
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.0" },
          },
        },
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string } }
    }
    expect(body.result?.serverInfo?.name).toBe(SERVER_NAME)
  })
})
