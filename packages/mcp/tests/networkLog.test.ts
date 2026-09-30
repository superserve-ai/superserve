import { afterEach, describe, expect, it, vi } from "vitest"

import { createSdkClient } from "../src/client.js"
import { callTool, connect } from "./harness.js"

describe("sandbox_network_log pagination", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("forwards the returned cursor to fetch the next page without resuming the sandbox", async () => {
    const cursor = "2026-09-30T10:00:00.123456789Z"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: 2, ts: cursor, host: "api.github.com" }],
          next_cursor: cursor,
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: 1, ts: "2026-09-30T09:00:00Z", host: "example.com" }],
          has_more: false,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const conn = await connect(
      createSdkClient({
        apiKey: "ss_test",
        baseUrl: "https://api.superserve.ai",
      }),
    )
    try {
      const { tools } = await conn.client.listTools()
      expect(
        tools.find((tool) => tool.name === "sandbox_network_log")?.inputSchema
          .properties?.before,
      ).toMatchObject({ type: "string", format: "date-time" })
      const args = { sandbox_id: "sbx-1", limit: 1, verdict: "allowed" }
      const first = await callTool(conn.client, "sandbox_network_log", args)
      expect(first.isError).toBe(false)
      expect(first.structured).toMatchObject({
        has_more: true,
        next_cursor: cursor,
      })

      const next = await callTool(conn.client, "sandbox_network_log", {
        ...args,
        before: first.structured.next_cursor,
      })
      expect(next.isError).toBe(false)
      expect(next.structured).toMatchObject({
        events: [{ id: 1, host: "example.com" }],
        has_more: false,
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)))
      expect(urls[0].searchParams.has("before")).toBe(false)
      expect(urls[1].searchParams.get("before")).toBe(cursor)
      for (const url of urls) {
        expect(url.pathname).toBe("/sandboxes/sbx-1/network")
        expect(url.searchParams.get("limit")).toBe("1")
        expect(url.searchParams.get("verdict")).toBe("allowed")
      }
    } finally {
      await conn.close()
    }
  })

  it("rejects an invalid cursor before making a request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const conn = await connect(
      createSdkClient({
        apiKey: "ss_test",
        baseUrl: "https://api.superserve.ai",
      }),
    )
    try {
      const result = await callTool(conn.client, "sandbox_network_log", {
        sandbox_id: "sbx-1",
        before: "not-a-timestamp",
      })
      expect(result.isError).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await conn.close()
    }
  })
})
