import { describe, test, expect } from "bun:test"
import { ExecStream } from "../src/exec-stream"
import type { ExecStreamEvent } from "../src/types"

function makeSSEResponse(events: Record<string, unknown>[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\n"
  return new Response(lines)
}

function makeStream(events: Record<string, unknown>[]): ExecStream {
  const response = makeSSEResponse(events)
  const controller = new AbortController()
  return new ExecStream(Promise.resolve(response), controller)
}

async function collectAll(stream: ExecStream): Promise<ExecStreamEvent[]> {
  const events: ExecStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

describe("ExecStream", () => {
  test("yields stdout, stderr, and exit events in order", async () => {
    const stream = makeStream([
      { stdout: "line 1\n" },
      { stderr: "warning\n" },
      { stdout: "line 2\n" },
      { finished: true, exit_code: 0 },
    ])

    const events = await collectAll(stream)
    expect(events).toEqual([
      { type: "stdout", data: "line 1\n" },
      { type: "stderr", data: "warning\n" },
      { type: "stdout", data: "line 2\n" },
      { type: "exit", exitCode: 0 },
    ])
  })

  test("result promise resolves with accumulated output", async () => {
    const stream = makeStream([
      { stdout: "hello " },
      { stdout: "world" },
      { stderr: "err" },
      { finished: true, exit_code: 42 },
    ])

    // Must iterate to drive the stream
    for await (const _ of stream) {
      // consume
    }

    const result = await stream.result
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "err",
      exitCode: 42,
    })
  })

  test("throws on double iteration", async () => {
    const stream = makeStream([{ finished: true, exit_code: 0 }])

    // First iteration
    for await (const _ of stream) {
      // consume
    }

    // Second iteration should throw
    expect(async () => {
      for await (const _ of stream) {
        // should not reach
      }
    }).toThrow("ExecStream can only be iterated once")
  })

  test("abort() calls controller.abort()", async () => {
    const controller = new AbortController()
    const response = makeSSEResponse([{ finished: true, exit_code: 0 }])
    const stream = new ExecStream(Promise.resolve(response), controller)

    expect(controller.signal.aborted).toBe(false)
    stream.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  test("stdout iterable filters only stdout events", async () => {
    const stream = makeStream([
      { stdout: "out1" },
      { stderr: "err1" },
      { stdout: "out2" },
      { finished: true, exit_code: 0 },
    ])

    const chunks: string[] = []
    for await (const chunk of stream.stdout) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(["out1", "out2"])
  })

  test("stderr iterable filters only stderr events", async () => {
    const stream = makeStream([
      { stdout: "out1" },
      { stderr: "err1" },
      { stderr: "err2" },
      { finished: true, exit_code: 0 },
    ])

    const chunks: string[] = []
    for await (const chunk of stream.stderr) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(["err1", "err2"])
  })

  test("result rejects when response promise rejects", async () => {
    const controller = new AbortController()
    const stream = new ExecStream(
      Promise.reject(new Error("connection failed")),
      controller,
    )

    try {
      for await (const _ of stream) {
        // should throw
      }
      expect(true).toBe(false)
    } catch (err) {
      expect((err as Error).message).toBe("connection failed")
    }

    try {
      await stream.result
      expect(true).toBe(false)
    } catch (err) {
      expect((err as Error).message).toBe("connection failed")
    }
  })
})
