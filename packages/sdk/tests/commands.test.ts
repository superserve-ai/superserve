import { afterEach, describe, expect, it, vi } from "vitest"

import { Commands, type CommandsDeps } from "../src/commands.js"
import { AuthenticationError, SandboxError } from "../src/errors.js"

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
const sandboxHost = "sandbox.superserve.ai"
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
})
