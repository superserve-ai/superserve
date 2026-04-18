import { afterEach, describe, expect, it, vi } from "vitest"

import { SandboxError, TimeoutError } from "../src/errors.js"
import { waitForStatus } from "../src/polling.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseUrl = "https://api.superserve.ai"
const apiKey = "ss_live_test"

describe("waitForStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns when sandbox reaches target status", async () => {
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++
        return jsonResponse({
          id: "sbx-1",
          status: calls >= 2 ? "active" : "starting",
          access_token: "tok",
        })
      }),
    )

    const info = await waitForStatus("sbx-1", "active", baseUrl, apiKey, {
      intervalMs: 5,
      timeoutMs: 5000,
    })
    expect(info.id).toBe("sbx-1")
    expect(info.status).toBe("active")
  })

  it("fails fast when sandbox enters failed state (target != failed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "sbx-1",
          status: "failed",
          access_token: "tok",
        }),
      ),
    )

    await expect(
      waitForStatus("sbx-1", "active", baseUrl, apiKey, {
        intervalMs: 5,
        timeoutMs: 5000,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SandboxError &&
        !(err instanceof TimeoutError) &&
        /failed/.test(err.message),
    )
  })

  it("fails fast when sandbox is deleted (target != deleted)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "sbx-1",
          status: "deleted",
          access_token: "tok",
        }),
      ),
    )

    await expect(
      waitForStatus("sbx-1", "active", baseUrl, apiKey, {
        intervalMs: 5,
        timeoutMs: 5000,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SandboxError &&
        !(err instanceof TimeoutError) &&
        /deleted/.test(err.message),
    )
  })

  it("times out after timeoutMs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "sbx-1",
          status: "starting",
          access_token: "tok",
        }),
      ),
    )

    await expect(
      waitForStatus("sbx-1", "active", baseUrl, apiKey, {
        intervalMs: 5,
        timeoutMs: 30,
      }),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it("aborts early when user signal is already aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "sbx-1",
          status: "starting",
          access_token: "tok",
        }),
      ),
    )

    const controller = new AbortController()
    controller.abort()

    await expect(
      waitForStatus("sbx-1", "active", baseUrl, apiKey, {
        signal: controller.signal,
        intervalMs: 5,
        timeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(SandboxError)
  })
})
