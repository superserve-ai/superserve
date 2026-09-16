import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ConflictError,
  SandboxError,
  TimeoutError,
  ValidationError,
} from "../src/errors.js"
import { Sandbox } from "../src/Sandbox.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(
  status: number,
  code = "error",
  message = "boom",
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseSandbox = {
  id: "sbx-1",
  name: "my-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 512,
  access_token: "tok-abc",
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Sandbox#getPreviewUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeSandbox(): Promise<Sandbox> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    return Sandbox.create({ ...commonOpts, name: "my-sandbox" })
  }

  it("builds a preview URL for a port", async () => {
    const sandbox = await makeSandbox()
    expect(sandbox.getPreviewUrl(3000)).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai",
    )
  })

  it("returns distinct URLs for multiple ports", async () => {
    const sandbox = await makeSandbox()
    expect(sandbox.getPreviewUrl(3000)).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai",
    )
    expect(sandbox.getPreviewUrl(8080)).toBe(
      "https://8080-sbx-1.sandbox.superserve.ai",
    )
  })

  it("throws ValidationError for an invalid port", async () => {
    const sandbox = await makeSandbox()
    expect(() => sandbox.getPreviewUrl(80)).toThrow(ValidationError)
  })
})

describe("Sandbox statics", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Sandbox.create posts to /sandboxes with correct body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      metadata: { env: "test" },
    })
    expect(sandbox.id).toBe("sbx-1")
    expect(sandbox.status).toBe("active")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["X-API-Key"]).toBe("ss_live_test")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "my-sandbox", metadata: { env: "test" } })
  })

  it("Sandbox.create sends auto_delete_seconds when set", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      autoDeleteSeconds: 3600,
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "my-sandbox", auto_delete_seconds: 3600 })
  })

  it("Sandbox.create sends a strict preview policy when requested", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ ...baseSandbox, preview_access: "private" }),
    )
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      previewAccess: "private",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      name: "my-sandbox",
      preview_access: "private",
    })
    expect(sandbox.previewAccess).toBe("private")
  })

  it("sandbox.update sets and clears auto_delete_seconds", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const patchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    await sandbox.update({ autoDeleteSeconds: 600 })
    let [url, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: 600,
    })

    await sandbox.update({ autoDeleteSeconds: null })
    ;[url, init] = patchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: null,
    })
  })

  it("sandbox.update sets and clears timeout_seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const patchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    await sandbox.update({ timeoutSeconds: 900 })
    let [, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ timeout_seconds: 900 })

    await sandbox.update({ timeoutSeconds: null })
    ;[, init] = patchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ timeout_seconds: null })
  })

  it("sandbox.update changes preview_access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseSandbox)),
    )
    const sandbox = await Sandbox.create({ ...commonOpts, name: "my-sandbox" })

    const patchMock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", patchMock)
    await sandbox.update({ previewAccess: "private" })

    const [, init] = patchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      preview_access: "private",
    })
  })

  it("Sandbox.updateById PATCHes directly without activating", async () => {
    const mock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", mock)

    await Sandbox.updateById("sbx-9", { autoDeleteSeconds: 3600 }, commonOpts)

    expect(mock).toHaveBeenCalledOnce()
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    // The whole point: no /activate call, so a paused sandbox stays paused.
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-9")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({
      auto_delete_seconds: 3600,
    })
  })

  it("Sandbox.create throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(
      Sandbox.create({ ...commonOpts, name: "no-token" }),
    ).rejects.toThrow(/missing access_token/)
  })

  it("Sandbox.connect POSTs /activate and returns instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.connect("sbx-1", commonOpts)
    expect(sandbox.id).toBe("sbx-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/activate")
    expect(init.method).toBe("POST")
  })

  it("Sandbox.connect throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(Sandbox.connect("sbx-1", commonOpts)).rejects.toThrow(
      /missing access_token/,
    )
  })

  it("Sandbox.list returns an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([baseSandbox, { ...baseSandbox, id: "sbx-2" }]),
      ),
    )

    const list = await Sandbox.list(commonOpts)
    expect(list).toHaveLength(2)
    expect(list[0]?.id).toBe("sbx-1")
    expect(list[1]?.id).toBe("sbx-2")
  })

  it("Sandbox.list appends metadata filters to URL", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Sandbox.list({
      ...commonOpts,
      metadata: { env: "prod", tier: "gold" },
    })
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("metadata.env=prod")
    expect(url).toContain("metadata.tier=gold")
  })

  it("Sandbox.list appends status, limit, and offset to URL", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Sandbox.list({
      ...commonOpts,
      status: "active",
      limit: 100,
      offset: 200,
    })
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("status=active")
    expect(url).toContain("limit=100")
    expect(url).toContain("offset=200")
  })

  it("Sandbox.list sends no query string without filters", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Sandbox.list(commonOpts)
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("?")
  })

  it("Sandbox.killById swallows 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).resolves.toBeUndefined()
  })

  it("Sandbox.killById propagates non-404 errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "server_error", "boom")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).rejects.toThrow()
  })
})

describe("Sandbox instance methods", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeSandbox(): Promise<Sandbox> {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({ ...commonOpts, name: "test" })
    vi.unstubAllGlobals()
    return sandbox
  }

  it("sandbox.kill swallows 404", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )
    await expect(sandbox.kill()).resolves.toBeUndefined()
  })

  it("sandbox.pause returns void and posts to /pause", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    const result = await sandbox.pause()
    expect(result).toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/pause")
    expect(init.method).toBe("POST")
  })

  it("sandbox.pause sends Prefer: respond-async and follows a 202 until paused", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "pausing" }, 202))
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSandbox, status: "pausing" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...baseSandbox, status: "paused" }))
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.pause({ wait: true, pollIntervalMs: 1 }),
    ).resolves.toBeUndefined()

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Prefer).toBe(
      "respond-async",
    )
    expect(mock).toHaveBeenCalledTimes(3)
    expect((mock.mock.calls[2] as [string])[0]).toBe(
      "https://api.superserve.ai/sandboxes/sbx-1",
    )
  })

  it("sandbox.pause rejects when the sandbox fails while pausing", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "pausing" }, 202))
      .mockImplementation(async () =>
        jsonResponse({ ...baseSandbox, status: "failed" }),
      )
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.pause({ wait: true, pollIntervalMs: 1 }),
    ).rejects.toThrow(/did not pause/)
  })

  it("sandbox.pause times out while the sandbox is still pausing", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "pausing" }, 202))
      .mockImplementation(async () =>
        jsonResponse({ ...baseSandbox, status: "pausing" }),
      )
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.pause({ wait: true, timeoutMs: 30, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it("sandbox.pause waits out a two-minute pause under the default budget", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      const start = Date.now()
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST") {
            await new Promise((r) => setTimeout(r, 20_000))
            return jsonResponse({ status: "pausing" }, 202)
          }
          return jsonResponse({
            ...baseSandbox,
            status: Date.now() - start >= 120_000 ? "paused" : "pausing",
          })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox.pause({ wait: true }).then(
        () => {
          outcome = "paused"
        },
        (e: unknown) => {
          outcome = e
        },
      )
      await vi.advanceTimersByTimeAsync(120_000)
      await pending
      expect(outcome).toBe("paused")
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause deadline cuts off a poll still in flight", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          await new Promise<void>((resolve, reject) => {
            setTimeout(resolve, 80)
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            )
          })
          return jsonResponse({ ...baseSandbox, status: "paused" })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 40, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(41)
      const atDeadline = outcome
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(atDeadline).toBeInstanceOf(TimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause abort stops a poll without waiting for its answer", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      let finishGet: (() => void) | undefined
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          return new Promise<Response>((resolve, reject) => {
            finishGet = () =>
              resolve(jsonResponse({ ...baseSandbox, status: "paused" }))
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            )
          })
        }),
      )
      const controller = new AbortController()
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({
          wait: true,
          timeoutMs: 120_000,
          pollIntervalMs: 10,
          signal: controller.signal,
        })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(10)
      expect(finishGet).toBeDefined()
      controller.abort()
      await vi.advanceTimersByTimeAsync(0)
      const afterAbort = outcome
      finishGet?.()
      await pending
      expect(afterAbort).toBeInstanceOf(SandboxError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause deadline covers a Retry-After wait inside a poll", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      let gets = 0
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.signal?.aborted)
            throw new DOMException("aborted", "AbortError")
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          if (++gets === 1) {
            return new Response(
              JSON.stringify({ error: { message: "retry later" } }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": "1",
                },
              },
            )
          }
          return jsonResponse({ ...baseSandbox, status: "paused" })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 40, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(41)
      const atDeadline = outcome
      await vi.advanceTimersByTimeAsync(1100)
      await pending
      expect(atDeadline).toBeInstanceOf(TimeoutError)
      expect(gets).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause abort interrupts a retry backoff inside a poll", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.signal?.aborted)
            throw new DOMException("aborted", "AbortError")
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          return new Response(
            JSON.stringify({ error: { message: "retry later" } }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "1",
              },
            },
          )
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({
          wait: true,
          timeoutMs: 120_000,
          pollIntervalMs: 10,
          signal: controller.signal,
        })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(10)
      controller.abort()
      await vi.advanceTimersByTimeAsync(0)
      const atAbort = outcome
      await vi.advanceTimersByTimeAsync(1100)
      await pending
      expect(atAbort).toBeInstanceOf(SandboxError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause deadline still applies while a poll body is being read", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              const timer = setTimeout(() => {
                stream.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ ...baseSandbox, status: "paused" }),
                  ),
                )
                stream.close()
              }, 80)
              init.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer)
                  stream.error(new DOMException("aborted", "AbortError"))
                },
                { once: true },
              )
            },
          })
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 40, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(41)
      const atDeadline = outcome
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(atDeadline).toBeInstanceOf(TimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause cuts a stalled poll body at the request timeout and polls again", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      let gets = 0
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          if (++gets > 1)
            return jsonResponse({ ...baseSandbox, status: "paused" })
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              init.signal?.addEventListener(
                "abort",
                () => stream.error(new DOMException("aborted", "AbortError")),
                { once: true },
              )
            },
          })
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 120_000, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(30_100)
      await pending
      expect(outcome).toBe("paused")
      expect(gets).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause treats a sandbox deleted on pause as completed", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "pausing" }, 202))
      .mockImplementation(async () => errorResponse(404, "not_found", "gone"))
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.pause({ wait: true, pollIntervalMs: 1 }),
    ).resolves.toBeUndefined()
  })

  it("sandbox.pause deadline still cuts a poll body read without AbortSignal.any", async () => {
    const sandbox = await makeSandbox()
    const anySignal = AbortSignal.any
    vi.useFakeTimers()
    try {
      // @ts-expect-error simulate a runtime without AbortSignal.any
      AbortSignal.any = undefined
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              const timer = setTimeout(() => {
                stream.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ ...baseSandbox, status: "paused" }),
                  ),
                )
                stream.close()
              }, 80)
              init.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer)
                  stream.error(new DOMException("aborted", "AbortError"))
                },
                { once: true },
              )
            },
          })
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 40, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(41)
      const atDeadline = outcome
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(atDeadline).toBeInstanceOf(TimeoutError)
    } finally {
      AbortSignal.any = anySignal
      vi.useRealTimers()
    }
  })

  it("sandbox.pause keeps polling after one status request times out", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      let gets = 0
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST")
            return jsonResponse({ status: "pausing" }, 202)
          if (++gets === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              )
            })
          }
          return jsonResponse({ ...baseSandbox, status: "paused" })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 120_000, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(30_100)
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(outcome).toBe("paused")
      expect(gets).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause follows a request that outlived its own timeout by polling", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          if (init.method === "POST") {
            return new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              )
            })
          }
          return jsonResponse({ ...baseSandbox, status: "paused" })
        }),
      )
      let outcome: unknown = "pending"
      const pending = sandbox
        .pause({ wait: true, timeoutMs: 120_000, pollIntervalMs: 10 })
        .then(
          () => {
            outcome = "paused"
          },
          (e: unknown) => {
            outcome = e
          },
        )
      await vi.advanceTimersByTimeAsync(30_100)
      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(outcome).toBe("paused")
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.pause returns once the pause is accepted, without polling", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => jsonResponse({ status: "pausing" }, 202))
    vi.stubGlobal("fetch", mock)

    await expect(sandbox.pause()).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("sandbox.resume waits out a pause in progress", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(409, "conflict", "not in a valid state"),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSandbox, status: "pausing" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSandbox, status: "pausing" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ...baseSandbox, status: "paused" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSandbox, access_token: "tok-2" }),
      )
    vi.stubGlobal("fetch", mock)

    await expect(sandbox.resume({ pollIntervalMs: 1 })).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(5)
    expect((mock.mock.calls[4] as [string, RequestInit])[1].method).toBe("POST")
  })

  it("sandbox.resume rethrows a conflict that is not a pause in progress", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(409, "conflict", "not in a valid state"),
      )
      .mockResolvedValueOnce(jsonResponse({ ...baseSandbox, status: "active" }))
    vi.stubGlobal("fetch", mock)

    await expect(sandbox.resume({ pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  it("sandbox.pause without wait surfaces a request timeout", async () => {
    const sandbox = await makeSandbox()
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              )
            }),
        ),
      )
      let outcome: unknown = "pending"
      const pending = sandbox.pause().then(
        () => {
          outcome = "accepted"
        },
        (e: unknown) => {
          outcome = e
        },
      )
      await vi.advanceTimersByTimeAsync(30_100)
      await pending
      expect(outcome).toBeInstanceOf(TimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("sandbox.resume retries at once when the conflict check already sees paused", async () => {
    const sandbox = await makeSandbox()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push(`${init.method} ${new URL(url).pathname}`)
        if (init.method === "GET")
          return jsonResponse({ ...baseSandbox, status: "paused" })
        if (seen.length === 1)
          return jsonResponse({ error: { message: "pausing" } }, 409)
        return jsonResponse({ ...baseSandbox, access_token: "tok-2" })
      }),
    )

    await sandbox.resume({ pollIntervalMs: 1 })
    expect(seen).toEqual([
      "POST /sandboxes/sbx-1/resume",
      "GET /sandboxes/sbx-1",
      "POST /sandboxes/sbx-1/resume",
    ])
  })

  it("sandbox.resume passes its signal to the resume POST and the conflict check", async () => {
    const sandbox = await makeSandbox()
    const controller = new AbortController()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push(`${init.method} ${new URL(url).pathname}`)
        if (init.signal?.aborted)
          throw new DOMException("aborted", "AbortError")
        if (init.method === "POST") {
          controller.abort()
          return jsonResponse({ error: { message: "pausing" } }, 409)
        }
        return jsonResponse(baseSandbox)
      }),
    )

    await expect(
      sandbox.resume({ signal: controller.signal }),
    ).rejects.toBeInstanceOf(SandboxError)
    expect(seen).toEqual([
      "POST /sandboxes/sbx-1/resume",
      "GET /sandboxes/sbx-1",
    ])
  })

  it("sandbox.attachSecret POSTs /secrets with env_key and secret_name", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () =>
      jsonResponse(
        { env_key: "ANTHROPIC_API_KEY", secret_name: "anthropic-prod" },
        201,
      ),
    )
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.attachSecret("ANTHROPIC_API_KEY", "anthropic-prod"),
    ).resolves.toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/secrets")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      env_key: "ANTHROPIC_API_KEY",
      secret_name: "anthropic-prod",
    })
  })

  it("sandbox.detachSecret DELETEs /secrets/{envKey}", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.detachSecret("ANTHROPIC_API_KEY"),
    ).resolves.toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "https://api.superserve.ai/sandboxes/sbx-1/secrets/ANTHROPIC_API_KEY",
    )
    expect(init.method).toBe("DELETE")
  })

  it("sandbox.detachSecret url-encodes the env key", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await sandbox.detachSecret("A/B")
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/secrets/A%2FB")
  })

  it("sandbox.resume rotates access token; files uses it transparently", async () => {
    const sandbox = await makeSandbox()
    const filesBefore = sandbox.files

    // Capture the new token when it flows through to a subsequent files.write
    const resumeMock = vi.fn(async () =>
      jsonResponse({
        id: "sbx-1",
        status: "active",
        access_token: "tok-new",
      }),
    )
    vi.stubGlobal("fetch", resumeMock)

    const result = await sandbox.resume()
    expect(result).toBeUndefined()

    const [url, init] = resumeMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/resume")
    expect(init.method).toBe("POST")

    // Files sub-module is the same stable instance (it reads the token live,
    // so there's no rebuild to swap the token in)
    expect(sandbox.files).toBe(filesBefore)

    // Verify subsequent file ops use the rotated token
    vi.unstubAllGlobals()
    const writeMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", writeMock)
    await sandbox.files.write("/tmp/x", "hi")
    const [, writeInit] = writeMock.mock.calls[0] as [string, RequestInit]
    const headers = writeInit.headers as Record<string, string>
    expect(headers["X-Access-Token"]).toBe("tok-new")
  })

  it("sandbox.resume throws when access_token missing", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "sbx-1", status: "active" })),
    )
    await expect(sandbox.resume()).rejects.toThrow(/missing access_token/)
  })

  it("publishes, lists, and unpublishes preview ports", async () => {
    const sandbox = await makeSandbox()
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ port: 3000, token_version: 2, access: "private" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          preview_access: "private",
          ports: [{ port: 3000, token_version: 2, access: "private" }],
        }),
      )
      .mockResolvedValueOnce(noContentResponse())
    vi.stubGlobal("fetch", mock)

    await expect(
      sandbox.publishPreviewPort(3000, { access: "private" }),
    ).resolves.toEqual({
      port: 3000,
      tokenVersion: 2,
      access: "private",
    })
    await expect(sandbox.listPreviewPorts()).resolves.toEqual({
      previewAccess: "private",
      ports: [{ port: 3000, tokenVersion: 2, access: "private" }],
    })
    await expect(sandbox.unpublishPreviewPort(3000)).resolves.toBeUndefined()

    expect((mock.mock.calls[0] as [string])[0]).toMatch(
      /\/sandboxes\/sbx-1\/preview-ports$/,
    )
    expect(
      JSON.parse(
        (mock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({ port: 3000, access: "private" })
    expect((mock.mock.calls[2] as [string, RequestInit])[1].method).toBe(
      "DELETE",
    )
  })

  it("rejects malformed preview-port list entries", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          preview_access: "private",
          ports: [{ token_version: 2 }],
        }),
      ),
    )

    await expect(sandbox.listPreviewPorts()).rejects.toThrow(
      "Invalid list-preview-ports response",
    )
  })

  it("mints a header token and a short-lived signed URL", async () => {
    const sandbox = await makeSandbox()
    const response = {
      token: "spv1.token",
      port: 3000,
      header: "X-Superserve-Preview-Token",
      query_param: "superserve_preview_token",
      token_version: 3,
      access: "private",
      preview_access: "private",
      expires_at: "2026-01-01T01:00:00Z",
    }
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(jsonResponse(response))
    vi.stubGlobal("fetch", mock)

    const token = await sandbox.getPreviewToken(3000, {
      expiresInSeconds: 3600,
    })
    expect(token.header).toBe("X-Superserve-Preview-Token")
    expect(token.tokenVersion).toBe(3)
    expect(token.access).toBe("private")
    const [, tokenInit] = mock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      expires_in_seconds: 3600,
    })

    const signed = await sandbox.getSignedPreviewUrl(3000)
    expect(signed).toBe(
      "https://3000-sbx-1.sandbox.superserve.ai/?superserve_preview_token=spv1.token",
    )
    const [, signedInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(signedInit.body as string)).toEqual({
      expires_in_seconds: 60,
    })
  })

  it("rotates one preview port token", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () =>
      jsonResponse({
        token: "spv1.fresh",
        port: 8080,
        header: "X-Superserve-Preview-Token",
        query_param: "superserve_preview_token",
        token_version: 4,
        access: "private",
        preview_access: "private",
      }),
    )
    vi.stubGlobal("fetch", mock)

    const token = await sandbox.rotatePreviewToken(8080)
    expect(token.tokenVersion).toBe(4)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/preview-ports\/8080\/token\/rotate$/)
    expect(init.method).toBe("POST")
  })
})

describe("Sandbox.create fromTemplate / fromSnapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("maps fromTemplate (string) to from_template body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: "superserve/python-3.11",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("superserve/python-3.11")
  })

  it("extracts name from Template-like instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { name: "my-env", id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("my-env")
  })

  it("falls back to id when name is undefined", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromTemplate: { id: "t-1" },
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_template).toBe("t-1")
  })

  it("maps fromSnapshot to from_snapshot body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      fromSnapshot: "snap-abc",
    })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.from_snapshot).toBe("snap-abc")
  })
})

describe("Sandbox concurrent token refresh coalesce", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("two concurrent 401-retries fire only one /activate", async () => {
    let activateCalls = 0
    let execCalls = 0
    const mock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/activate")) {
        activateCalls += 1
        // Slow enough that both concurrent callers race onto the same
        // in-flight promise.
        await new Promise((r) => setTimeout(r, 20))
        return jsonResponse({ ...baseSandbox, access_token: "tok-refreshed" })
      }
      if (url.endsWith("/exec")) {
        execCalls += 1
        if (execCalls <= 2) return errorResponse(401, "auth_failed")
        return jsonResponse({ stdout: "ok", stderr: "", exit_code: 0 })
      }
      return jsonResponse(baseSandbox)
    })
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.connect("sbx-1", commonOpts)
    expect(activateCalls).toBe(1) // baseline: connect() did one

    const [a, b] = await Promise.all([
      sandbox.commands.run("echo a"),
      sandbox.commands.run("echo b"),
    ])

    expect(a.exitCode).toBe(0)
    expect(b.exitCode).toBe(0)
    // Two concurrent 401s → ONE additional /activate (coalesced)
    expect(activateCalls).toBe(2)
    expect(execCalls).toBe(4) // 2 initial 401s + 2 successful retries
  })
})
