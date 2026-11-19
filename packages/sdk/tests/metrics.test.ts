import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AuthenticationError,
  NotFoundError,
  Sandbox,
  SandboxError,
  ServerError,
  type SandboxMetrics,
} from "../src/index.js"
import type { ApiSandboxMetrics } from "../src/types.js"

const connection = {
  apiKey: "ss_test_metrics",
  baseUrl: "https://api.example.com",
}

function metrics(status: "paused" | "failed" = "paused"): ApiSandboxMetrics {
  return {
    id: "sbx-metrics",
    status,
    cpu: {
      configured_vcpus: 2,
      effective_vcpus: null,
      limit_vcpus: 4,
      usage: {
        used_vcpus: 0,
        sampled_at: "2026-01-01T00:00:01.123Z",
        window_seconds: 1.25,
        source: "last_known",
      },
    },
    memory: {
      configured_bytes: 536870912,
      effective_bytes: 0,
      limit_bytes: 1073741824,
      usage: {
        used_bytes: 0,
        sampled_at: "2026-01-01T00:00:02.456Z",
        source: "live",
      },
    },
    disk: {
      configured_bytes: 2147483648,
      effective_bytes: null,
      limit_bytes: 2147483648,
      usage: {
        total_bytes: 2000000000,
        used_bytes: 0,
        available_bytes: 1900000000,
        sampled_at: "2025-12-31T23:59:59.789Z",
        source: "last_known",
      },
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("cached sandbox metrics", () => {
  it.each(["paused", "failed"] as const)(
    "reads %s directly by ID, with configured auth and no activation",
    async (status) => {
      const fetch = vi.fn(async () => json(metrics(status)))
      vi.stubGlobal("fetch", fetch)
      const result: SandboxMetrics = await Sandbox.getMetricsById(
        "sbx-metrics",
        connection,
      )
      expect(result.status).toBe(status)
      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      expect(url).toBe(`${connection.baseUrl}/sandboxes/sbx-metrics/metrics`)
      expect(init.method).toBe("GET")
      expect(init.headers).toMatchObject({ "X-API-Key": connection.apiKey })
      expect(result.cpu).toEqual({
        configuredVcpus: 2,
        effectiveVcpus: null,
        limitVcpus: 4,
        usage: {
          usedVcpus: 0,
          sampledAt: new Date("2026-01-01T00:00:01.123Z"),
          windowSeconds: 1.25,
          source: "last_known",
        },
      })
      expect(result.memory.usage).toEqual({
        usedBytes: 0,
        sampledAt: new Date("2026-01-01T00:00:02.456Z"),
        source: "live",
      })
      expect(result.memory.effectiveBytes).toBe(0)
      expect(result.disk.usage).toEqual({
        totalBytes: 2000000000,
        usedBytes: 0,
        availableBytes: 1900000000,
        sampledAt: new Date("2025-12-31T23:59:59.789Z"),
        source: "last_known",
      })
      expect(result.disk.effectiveBytes).toBeNull()
    },
  )

  it("preserves independently missing observations", async () => {
    const raw = metrics()
    raw.cpu.usage = null
    raw.disk.usage = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(raw)),
    )
    const result = await Sandbox.getMetricsById(raw.id, connection)
    expect(result.cpu.usage).toBeNull()
    expect(result.disk.usage).toBeNull()
    expect(result.memory.usage?.usedBytes).toBe(0)
    raw.memory.usage = null
    expect(
      (await Sandbox.getMetricsById(raw.id, connection)).memory.usage,
    ).toBeNull()
  })

  it("uses an existing handle's control-plane credentials without refreshing its token", async () => {
    const fetch = vi.fn(async () =>
      json({
        id: "sbx-metrics",
        name: "test",
        status: "active",
        access_token: "old-token",
        created_at: "2026-01-01T00:00:00Z",
      }),
    )
    vi.stubGlobal("fetch", fetch)
    const sandbox = await Sandbox.create({ ...connection, name: "test" })
    fetch.mockClear()
    fetch.mockImplementation(async () => json(metrics("failed")))
    expect((await sandbox.getMetrics()).status).toBe("failed")
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${connection.baseUrl}/sandboxes/sbx-metrics/metrics`)
    expect(init.method).toBe("GET")
    expect(init.headers).toMatchObject({ "X-API-Key": connection.apiKey })
    expect(init.headers).not.toHaveProperty("Authorization")
  })

  it.each([
    [401, AuthenticationError],
    [404, NotFoundError],
    [500, ServerError],
  ] as const)(
    "propagates the existing typed error for %i",
    async (status, error) => {
      const fetch = vi.fn(async () =>
        json({ error: { message: "unavailable" } }, status),
      )
      vi.stubGlobal("fetch", fetch)
      await expect(
        Sandbox.getMetricsById("sbx-metrics", connection),
      ).rejects.toBeInstanceOf(error)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it("retains bounded GET retries without calling a lifecycle endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json(metrics()))
    vi.stubGlobal("fetch", fetch)
    await Sandbox.getMetricsById("sbx-metrics", connection)
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(`${connection.baseUrl}/sandboxes/sbx-metrics/metrics`)
      expect(init.method).toBe("GET")
    }
  })

  it("passes cancellation through the existing HTTP client", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          )
        }),
    )
    vi.stubGlobal("fetch", fetch)
    const controller = new AbortController()
    const pending = Sandbox.getMetricsById("sbx-metrics", {
      ...connection,
      signal: controller.signal,
    })
    const reason = new DOMException("cancel metrics", "AbortError")
    controller.abort(reason)
    const error = await pending.catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SandboxError)
    expect(error).toMatchObject({ message: "Request aborted", cause: reason })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
