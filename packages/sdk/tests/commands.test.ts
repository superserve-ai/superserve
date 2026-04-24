import { afterEach, describe, expect, it, vi } from "vitest"

import { Commands } from "../src/commands.js"
import { SandboxError } from "../src/errors.js"

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

const baseUrl = "https://api.superserve.ai"
const apiKey = "ss_live_test"
const sandboxId = "sbx-1"

describe("Commands.run (sync)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns stdout/stderr/exitCode from API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          stdout: "hello\n",
          stderr: "warn\n",
          exit_code: 0,
        }),
      ),
    )

    const commands = new Commands(baseUrl, sandboxId, apiKey)
    const result = await commands.run("echo hello")
    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "warn\n",
      exitCode: 0,
    })
  })

  it("converts timeoutMs to timeout_s (ceiled)", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ stdout: "", stderr: "", exit_code: 0 }),
    )
    vi.stubGlobal("fetch", mock)

    const commands = new Commands(baseUrl, sandboxId, apiKey)
    await commands.run("sleep 1", { timeoutMs: 2500 })

    const init = mock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(body.timeout_s).toBe(3)
  })
})

describe("Commands.run (streaming)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls onStdout for each chunk and returns aggregated result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ stdout: "hi " })}\n`,
          `data: ${JSON.stringify({ stdout: "there" })}\n`,
          `data: ${JSON.stringify({ finished: true, exit_code: 0 })}\n`,
        ]),
      ),
    )

    const received: string[] = []
    const commands = new Commands(baseUrl, sandboxId, apiKey)
    const result = await commands.run("echo", {
      onStdout: (d) => received.push(d),
    })
    expect(received).toEqual(["hi ", "there"])
    expect(result.stdout).toBe("hi there")
    expect(result.exitCode).toBe(0)
  })

  it("throws if stream ends without finished event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([`data: ${JSON.stringify({ stdout: "partial" })}\n`]),
      ),
    )

    const commands = new Commands(baseUrl, sandboxId, apiKey)
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

    const commands = new Commands(baseUrl, sandboxId, apiKey)
    const result = await commands.run("bad", {
      onStderr: () => {},
    })
    expect(result.stderr).toBe("warn\ncrashed")
    expect(result.exitCode).toBe(1)
  })
})
