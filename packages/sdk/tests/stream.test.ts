import { describe, expect, mock, test } from "bun:test"
import { AgentStream } from "../src/stream"

function makeSSEResponse(events: { type: string; data: unknown }[]): Response {
  const encoder = new TextEncoder()
  const raw = events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("")

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw))
      controller.close()
    },
  })
  return new Response(stream)
}

function makeStream(
  events: { type: string; data: unknown }[],
  callbacks = {},
) {
  const response = Promise.resolve(makeSSEResponse(events))
  const controller = new AbortController()
  return new AgentStream(response, controller, callbacks)
}

describe("AgentStream", () => {
  test("iterates over text events", async () => {
    const stream = makeStream([
      { type: "message.delta", data: { content: "hello " } },
      { type: "message.delta", data: { content: "world" } },
      { type: "run.completed", data: { duration_ms: 100 } },
    ])

    const events = []
    for await (const event of stream) {
      events.push(event)
    }

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({ type: "text", content: "hello " })
    expect(events[1]).toEqual({ type: "text", content: "world" })
    expect(events[2]).toEqual({
      type: "run-completed",
      duration: 100,
      maxTurnsReached: false,
    })
  })

  test("result resolves with aggregated data", async () => {
    const stream = makeStream([
      { type: "message.delta", data: { content: "hello " } },
      { type: "message.delta", data: { content: "world" } },
      { type: "run.completed", data: { duration_ms: 200 } },
    ])

    const result = await stream.result

    expect(result.text).toBe("hello world")
    expect(result.finishReason).toBe("completed")
    expect(result.duration).toBe(200)
    expect(result.maxTurnsReached).toBe(false)
    expect(result.toolCalls).toEqual([])
  })

  test("tracks tool calls", async () => {
    const stream = makeStream([
      { type: "tool.start", data: { tool: "bash", input: { cmd: "ls" } } },
      { type: "tool.end", data: { duration_ms: 50 } },
      { type: "run.completed", data: { duration_ms: 100 } },
    ])

    const result = await stream.result

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe("bash")
    expect(result.toolCalls[0].input).toEqual({ cmd: "ls" })
    expect(result.toolCalls[0].duration).toBe(50)
  })

  test("tracks multiple tool calls", async () => {
    const stream = makeStream([
      { type: "tool.start", data: { tool: "bash", input: "ls" } },
      { type: "tool.end", data: { duration_ms: 50 } },
      { type: "tool.start", data: { tool: "read", input: "file.txt" } },
      { type: "tool.end", data: { duration_ms: 30 } },
      { type: "run.completed", data: { duration_ms: 200 } },
    ])

    const result = await stream.result
    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0].name).toBe("bash")
    expect(result.toolCalls[1].name).toBe("read")
  })

  test("handles run failure", async () => {
    const stream = makeStream([
      { type: "message.delta", data: { content: "partial" } },
      { type: "run.failed", data: { error: { message: "out of memory" } } },
    ])

    const result = await stream.result
    expect(result.text).toBe("partial")
    expect(result.finishReason).toBe("failed")
  })

  test("throws when iterated twice", async () => {
    const stream = makeStream([
      { type: "run.completed", data: { duration_ms: 0 } },
    ])

    // First iteration
    for await (const _ of stream) {
      // consume
    }

    // Second iteration should throw
    expect(async () => {
      for await (const _ of stream) {
        // should not reach
      }
    }).toThrow("AgentStream can only be iterated once")
  })

  test("textStream yields only text chunks", async () => {
    const stream = makeStream([
      { type: "message.delta", data: { content: "hello " } },
      { type: "tool.start", data: { tool: "bash", input: null } },
      { type: "tool.end", data: { duration_ms: 10 } },
      { type: "message.delta", data: { content: "world" } },
      { type: "run.completed", data: { duration_ms: 100 } },
    ])

    const chunks: string[] = []
    for await (const text of stream.textStream) {
      chunks.push(text)
    }

    expect(chunks).toEqual(["hello ", "world"])
  })

  test("fires onText callback", async () => {
    const onText = mock(() => {})
    const stream = makeStream(
      [
        { type: "message.delta", data: { content: "hello" } },
        { type: "run.completed", data: { duration_ms: 0 } },
      ],
      { onText },
    )

    await stream.result
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith("hello")
  })

  test("fires onToolStart and onToolEnd callbacks", async () => {
    const onToolStart = mock(() => {})
    const onToolEnd = mock(() => {})
    const stream = makeStream(
      [
        { type: "tool.start", data: { tool: "bash", input: "ls" } },
        { type: "tool.end", data: { duration_ms: 50 } },
        { type: "run.completed", data: { duration_ms: 100 } },
      ],
      { onToolStart, onToolEnd },
    )

    await stream.result
    expect(onToolStart).toHaveBeenCalledTimes(1)
    expect(onToolEnd).toHaveBeenCalledTimes(1)
  })

  test("fires onFinish callback on success", async () => {
    const onFinish = mock(() => {})
    const stream = makeStream(
      [
        { type: "message.delta", data: { content: "done" } },
        { type: "run.completed", data: { duration_ms: 50 } },
      ],
      { onFinish },
    )

    await stream.result
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0].text).toBe("done")
    expect(onFinish.mock.calls[0][0].finishReason).toBe("completed")
  })

  test("fires onError callback on failure", async () => {
    const onError = mock(() => {})
    const stream = makeStream(
      [
        { type: "run.failed", data: { error: { message: "boom" } } },
      ],
      { onError },
    )

    await stream.result
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  test("abort cancels the stream", () => {
    const controller = new AbortController()
    const stream = new AgentStream(
      new Promise(() => {}), // never resolves
      controller,
    )

    stream.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  test("handles maxTurnsReached", async () => {
    const stream = makeStream([
      {
        type: "run.completed",
        data: { duration_ms: 300, max_turns_reached: true },
      },
    ])

    const result = await stream.result
    expect(result.maxTurnsReached).toBe(true)
  })
})
