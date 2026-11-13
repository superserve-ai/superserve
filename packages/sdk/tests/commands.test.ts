import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Commands,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_EXEC_RESPONSE_BYTES,
  MAX_SYNC_EXEC_TIMEOUT_S,
  SYNC_EXEC_OUTPUT_CAP_BYTES,
  type CommandsDeps,
} from "../src/commands.js"
import {
  AuthenticationError,
  SandboxError,
  TimeoutError,
  ValidationError,
} from "../src/errors.js"
import { DEFAULT_TIMEOUT_MS } from "../src/http.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

const sandboxId = "sbx-1"
const sandboxHost = "sandbox.example.com"
const dataPlaneUrl = `https://boxd-${sandboxId}.${sandboxHost}`

function makeDeps(overrides: Partial<CommandsDeps> = {}): CommandsDeps {
  let token = "tok-initial"
  return {
    sandboxId,
    sandboxHost,
    getAccessToken: () => token,
    refreshActivate: async () => {
      token = "tok-refreshed"
      return token
    },
    ...overrides,
  }
}

describe("Commands.run (sync) output cap", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function streamedResponse(body: Uint8Array): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // The data plane is untrusted: boxd buffers the command's full stdout/stderr
  // in the VM and returns it in one JSON body, and neither the proxy nor fetch
  // caps it — so a command can stream back as much output as the sandbox has
  // RAM. The sync read must abort at the cap instead of buffering it all.
  it("aborts a /exec body larger than MAX_EXEC_RESPONSE_BYTES", async () => {
    const oversized = new Uint8Array(MAX_EXEC_RESPONSE_BYTES + 64)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(oversized)),
    )

    const commands = new Commands(makeDeps())
    await expect(commands.run("cat /dev/zero")).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it("honors a smaller maxOutputBytes override", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ stdout: "x".repeat(4096), stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(body)),
    )

    const commands = new Commands(makeDeps())
    await expect(
      commands.run("echo big", { maxOutputBytes: 512 }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("returns output unchanged when under the cap", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({ stdout: "hi\n", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamedResponse(body)),
    )

    const commands = new Commands(makeDeps())
    const result = await commands.run("echo hi", { maxOutputBytes: 1024 })
    expect(result).toEqual({
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
      truncated: false,
    })
  })
})

describe("Commands.run (sync)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hits the data-plane /exec with X-Access-Token", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "hello\n", stderr: "warn\n", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    const result = await commands.run("echo hello")

    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "warn\n",
      exitCode: 0,
      truncated: false,
    })
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${dataPlaneUrl}/exec`)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["X-Access-Token"]).toBe(
      "tok-initial",
    )
    expect(
      (init.headers as Record<string, string>)["X-API-Key"],
    ).toBeUndefined()
  })

  it("surfaces the server's truncated flag", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({
        stdout: "partial",
        stderr: "",
        exit_code: 0,
        truncated: true,
      }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    const result = await commands.run("yes")

    expect(result.truncated).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it("converts timeoutMs to timeout_s (ceiled)", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    await commands.run("sleep 1", { timeoutMs: 2500 })

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.timeout_s).toBe(3)
  })

  it("sends user only when set", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(makeDeps())
    await commands.run("apt-get update", { user: "root" })
    await commands.run("id")

    const bodies = mock.mock.calls.map((c) =>
      JSON.parse((c[1] as RequestInit).body as string),
    )
    expect(bodies[0].user).toBe("root")
    expect(bodies[1]).not.toHaveProperty("user")
  })

  it("refreshes token + retries on AuthenticationError, then succeeds", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })

    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    const result = await commands.run("echo")

    expect(result.stdout).toBe("ok\n")
    expect(refreshCalled).toBe(1)
    expect(mock).toHaveBeenCalledTimes(2)
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(
      (secondInit.headers as Record<string, string>)["X-Access-Token"],
    ).toBe("tok-refreshed")
  })

  it("does NOT retry on non-auth errors (e.g. 500)", async () => {
    const deps = makeDeps()
    const mock = vi.fn(async () =>
      jsonResponse({ error: { code: "server_error" } }, 500),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    await expect(commands.run("echo")).rejects.toBeInstanceOf(SandboxError)
  })

  it("resumes + retries on 503 (paused sandbox), then succeeds", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })

    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "sandbox_paused", message: "sandbox is paused" } },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const result = await new Commands(deps).run("echo")

    expect(result.stdout).toBe("ok\n")
    expect(refreshCalled).toBe(1)
    expect(mock).toHaveBeenCalledTimes(2)
    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    expect(
      (secondInit.headers as Record<string, string>)["X-Access-Token"],
    ).toBe("tok-refreshed")
  })

  it("does NOT resume on a genuine 500 (only 503 means paused)", async () => {
    let refreshCalled = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalled += 1
        return "tok-refreshed"
      },
    })
    const mock = vi.fn(async () =>
      jsonResponse({ error: { code: "server_error" } }, 500),
    )
    vi.stubGlobal("fetch", mock)

    await expect(new Commands(deps).run("echo")).rejects.toBeInstanceOf(
      SandboxError,
    )
    expect(refreshCalled).toBe(0)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("propagates AuthenticationError if refresh also fails", async () => {
    const deps = makeDeps({
      refreshActivate: async () => "tok-refreshed",
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code: "auth_failed" } }, 401))
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(deps)
    await expect(commands.run("echo")).rejects.toBeInstanceOf(
      AuthenticationError,
    )
  })
})

describe("Commands.run (streaming)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hits data-plane /exec/stream and aggregates stdout chunks", async () => {
    const mock = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ stdout: "hi " })}\n`,
        `data: ${JSON.stringify({ stdout: "there" })}\n`,
        `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const received: string[] = []
    const commands = new Commands(makeDeps())
    const result = await commands.run("echo", {
      onStdout: (d) => received.push(d),
    })

    expect(received).toEqual(["hi ", "there"])
    expect(result.stdout).toBe("hi there")
    expect(result.exitCode).toBe(0)
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe(`${dataPlaneUrl}/exec/stream`)
  })

  it("throws if stream ends without finished event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([`data: ${JSON.stringify({ stdout: "partial" })}\n`]),
      ),
    )

    const commands = new Commands(makeDeps())
    await expect(
      commands.run("echo", { onStdout: () => {} }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SandboxError && /finished event/.test(err.message),
    )
  })

  it("appends error field from finished event to stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ stderr: "warn\n" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 1, error: "crashed" })}\n`,
        ]),
      ),
    )

    const commands = new Commands(makeDeps())
    const result = await commands.run("bad", { onStderr: () => {} })
    expect(result.stderr).toBe("warn\ncrashed")
    expect(result.exitCode).toBe(1)
  })

  it("streaming retry on 401 doesn't double-emit callbacks", async () => {
    let refreshCalls = 0
    const deps = makeDeps({
      refreshActivate: async () => {
        refreshCalls += 1
        return "tok-refreshed"
      },
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        sseResponse([
          `data: ${JSON.stringify({ stdout: "one" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
        ]),
      )
    vi.stubGlobal("fetch", mock)

    const received: string[] = []
    const commands = new Commands(deps)
    const result = await commands.run("echo", {
      onStdout: (d) => received.push(d),
    })

    // Callbacks fire exactly once — the 401 attempt never invoked onStdout
    expect(received).toEqual(["one"])
    expect(result.stdout).toBe("one")
    expect(result.exitCode).toBe(0)
    expect(refreshCalls).toBe(1)
  })
})

describe("Commands.run (shared-host routing)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses shared host + X-Superserve-Sandbox-Id when sandboxHost is supported", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "hi\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "sandbox.superserve.ai" }),
    )
    await commands.run("echo hi")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://sandbox.superserve.ai/exec")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe("tok-initial")
  })

  it("falls back to per-sandbox subdomain on unsupported host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "self-hosted.example.org" }),
    )
    await commands.run("echo")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://boxd-${sandboxId}.self-hosted.example.org/exec`)
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBeUndefined()
  })

  it("streaming carries X-Superserve-Sandbox-Id on shared host", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          `data: ${JSON.stringify({ stdout: "x" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
        ]),
      )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(
      makeDeps({ sandboxHost: "sandbox.superserve.ai" }),
    )
    await commands.run("echo", { onStdout: () => {} })

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://sandbox.superserve.ai/exec/stream")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
  })

  it("preserves X-Superserve-Sandbox-Id after 401 retry on shared host", async () => {
    const deps = makeDeps({
      sandboxHost: "sandbox.superserve.ai",
      refreshActivate: async () => "tok-refreshed",
    })
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "auth_failed" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ stdout: "ok\n", stderr: "", exit_code: 0 }),
      )
    vi.stubGlobal("fetch", mock)

    await new Commands(deps).run("echo")

    const [, secondInit] = mock.mock.calls[1] as [string, RequestInit]
    const headers = secondInit.headers as Record<string, string>
    expect(headers["X-Superserve-Sandbox-Id"]).toBe(sandboxId)
    expect(headers["X-Access-Token"]).toBe("tok-refreshed")
  })
})

describe("Commands.run timeouts", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function abortWith(
    init: RequestInit | undefined,
    onAbort: (e: unknown) => void,
  ) {
    init?.signal?.addEventListener("abort", () =>
      onAbort(init.signal?.reason ?? new DOMException("aborted", "AbortError")),
    )
  }

  // A data plane that never answers, to observe when the client gives up.
  function hungServer() {
    return vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => abortWith(init, reject)),
    )
  }

  function settle<T>(p: Promise<T>) {
    return p.then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    )
  }

  function sentBody(mock: ReturnType<typeof vi.fn>) {
    const init = mock.mock.calls[0]?.[1] as RequestInit
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it.each([
    ["omitted", {}],
    ["0", { timeoutMs: 0 }],
  ])(
    "timeoutMs %s sends no timeout_s and keeps the default request deadline (sync)",
    async (_label, options) => {
      vi.useFakeTimers()
      const mock = hungServer()
      vi.stubGlobal("fetch", mock)

      const result = settle(new Commands(makeDeps()).run("sleep 60", options))
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS)
      const { error } = await result

      expect(sentBody(mock)).not.toHaveProperty("timeout_s")
      expect(error).toBeInstanceOf(TimeoutError)
      expect((error as Error).message).toBe(
        `Request timed out after ${DEFAULT_TIMEOUT_MS}ms`,
      )
    },
  )

  it("timeoutMs: 0 is the same as omitting it, not a 5s idle deadline (streaming)", async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const mock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"stdout":"a"}\n'))
              const timer = setTimeout(() => {
                controller.enqueue(
                  encoder.encode('data: {"finished":true,"exit_code":0}\n'),
                )
                controller.close()
              }, 10_000)
              abortWith(init, (e) => {
                clearTimeout(timer)
                controller.error(e)
              })
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    )
    vi.stubGlobal("fetch", mock)

    const result = settle(
      new Commands(makeDeps()).run("sleep 10", {
        timeoutMs: 0,
        onStdout: () => {},
      }),
    )
    await vi.advanceTimersByTimeAsync(10_000)
    const { value, error } = await result

    expect(error).toBeUndefined()
    expect(value?.stdout).toBe("a")
    expect(sentBody(mock)).not.toHaveProperty("timeout_s")
  })

  it("gives up 5s after the server's rounded-up deadline, not 5s after timeoutMs", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", hungServer())

    // timeout_s rounds 1001ms up to 2s, so the client must wait until 7s.
    const result = settle(
      new Commands(makeDeps()).run("sleep 9", { timeoutMs: 1_001 }),
    )
    await vi.advanceTimersByTimeAsync(6_999)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1)
    const { error } = await result

    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as Error).message).toBe("Request timed out after 7000ms")
  })

  it("accepts the largest timeoutMs whose client deadline fits a timer", async () => {
    vi.useFakeTimers()
    const mock = hungServer()
    vi.stubGlobal("fetch", mock)
    const controller = new AbortController()

    const result = settle(
      new Commands(makeDeps()).run("sleep infinity", {
        timeoutMs: MAX_COMMAND_TIMEOUT_MS,
        signal: controller.signal,
      }),
    )
    await vi.advanceTimersByTimeAsync(60_000)
    controller.abort()
    const { error } = await result

    expect(sentBody(mock).timeout_s).toBe(MAX_COMMAND_TIMEOUT_MS / 1000)
    expect(error).toBeInstanceOf(SandboxError)
    expect(error).not.toBeInstanceOf(TimeoutError)
  })

  const invalid = [
    -1,
    -10_000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    MAX_COMMAND_TIMEOUT_MS + 1,
    2 ** 31,
    3_000_000_000,
  ]

  it.each(invalid)(
    "rejects timeoutMs %s before sending a sync request",
    async (timeoutMs) => {
      const mock = hungServer()
      vi.stubGlobal("fetch", mock)

      await expect(
        new Commands(makeDeps()).run("echo", { timeoutMs }),
      ).rejects.toThrow(ValidationError)
      expect(mock).not.toHaveBeenCalled()
    },
  )

  it.each(invalid)(
    "rejects timeoutMs %s before opening a stream",
    async (timeoutMs) => {
      const mock = hungServer()
      vi.stubGlobal("fetch", mock)

      await expect(
        new Commands(makeDeps()).run("echo", { timeoutMs, onStdout: () => {} }),
      ).rejects.toThrow(ValidationError)
      expect(mock).not.toHaveBeenCalled()
    },
  )
})

describe("Commands.run without callbacks and a long timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const longTimeoutMs = (MAX_SYNC_EXEC_TIMEOUT_S + 1) * 1000
  const finished = (exitCode = 0) =>
    `data: ${JSON.stringify({ finished: true, exit_code: exitCode })}\n\n`

  it("keeps using /exec at the longest sync timeout", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "ok", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    await new Commands(makeDeps()).run("sleep 1", {
      timeoutMs: MAX_SYNC_EXEC_TIMEOUT_S * 1000,
    })

    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe(`${dataPlaneUrl}/exec`)
  })

  it("runs over /exec/stream and collects the output", async () => {
    const mock = vi.fn(async () =>
      sseResponse([
        ": keepalive\n\n",
        `data: ${JSON.stringify({ stdout: "hi " })}\n\n`,
        `data: ${JSON.stringify({ stderr: "warn" })}\n\n`,
        `data: ${JSON.stringify({ stdout: "there" })}\n\n`,
        finished(3),
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const result = await new Commands(makeDeps()).run("long-job", {
      timeoutMs: longTimeoutMs,
    })

    expect(result).toEqual({
      stdout: "hi there",
      stderr: "warn",
      exitCode: 3,
      truncated: false,
    })
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${dataPlaneUrl}/exec/stream`)
    expect(JSON.parse(init.body as string).timeout_s).toBe(
      MAX_SYNC_EXEC_TIMEOUT_S + 1,
    )
  })

  it("keeps the sandbox's sync output cap and marks the result truncated", async () => {
    const half = SYNC_EXEC_OUTPUT_CAP_BYTES / 2
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ stdout: "a".repeat(half) })}\n\n`,
          `data: ${JSON.stringify({ stderr: "b".repeat(half - 1) })}\n\n`,
          `data: ${JSON.stringify({ stdout: "é" })}\n\n`,
          `data: ${JSON.stringify({ stdout: "more" })}\n\n`,
          finished(0),
        ]),
      ),
    )

    const result = await new Commands(makeDeps()).run("noisy", {
      timeoutMs: longTimeoutMs,
    })

    // "é" is 2 bytes and only 1 byte is left, so none of it is kept.
    expect(result.stdout).toBe("a".repeat(half))
    expect(result.stderr.startsWith("b".repeat(half - 1))).toBe(true)
    expect(result.stderr).toContain("output truncated")
    expect(result.exitCode).toBe(0)
    expect(result.truncated).toBe(true)
  })

  it("throws ValidationError once output passes a smaller maxOutputBytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ stdout: "x".repeat(10) })}\n\n`,
          `data: ${JSON.stringify({ stdout: "y" })}\n\n`,
          finished(0),
        ]),
      ),
    )

    await expect(
      new Commands(makeDeps()).run("noisy", {
        timeoutMs: longTimeoutMs,
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it("stops the stream when output passes a smaller maxOutputBytes", async () => {
    let signal: AbortSignal | undefined
    const encoder = new TextEncoder()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        // Sends output past the cap, then never ends.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ stdout: "x".repeat(11) })}\n\n`,
              ),
            )
            signal?.addEventListener("abort", () =>
              controller.error(signal?.reason),
            )
          },
        })
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        })
      }),
    )

    await expect(
      new Commands(makeDeps()).run("noisy", {
        timeoutMs: longTimeoutMs,
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow("exceeds the maximum size of 10 bytes")
    expect(signal?.aborted).toBe(true)
  })

  it("throws ValidationError on one event longer than a smaller maxOutputBytes allows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        // No newline: the event never completes.
        sseResponse([`data: ${JSON.stringify({ stdout: "x".repeat(2_000) })}`]),
      ),
    )

    await expect(
      new Commands(makeDeps()).run("noisy", {
        timeoutMs: longTimeoutMs,
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it("caps the finished event's error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ finished: true, exit_code: 1, error: "e".repeat(10_000) })}\n\n`,
        ]),
      ),
    )

    const result = await new Commands(makeDeps()).run("fails", {
      timeoutMs: longTimeoutMs,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe("e".repeat(4096))
  })
})
