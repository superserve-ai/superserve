import { describe, expect, test } from "bun:test"
import { parseSSEStream } from "../src/sse"

function makeSSEResponse(raw: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw))
      controller.close()
    },
  })
  return new Response(stream)
}

function makeChunkedSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream)
}

describe("parseSSEStream", () => {
  test("parses a single message.delta event", async () => {
    const response = makeSSEResponse(
      'event: message.delta\ndata: {"content":"hello"}\n\n',
    )
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("message.delta")
    expect(events[0].data).toEqual({ content: "hello" })
  })

  test("parses multiple events", async () => {
    const raw = [
      'event: message.delta\ndata: {"content":"hello "}\n\n',
      'event: message.delta\ndata: {"content":"world"}\n\n',
      'event: run.completed\ndata: {"duration_ms":100}\n\n',
    ].join("")

    const response = makeSSEResponse(raw)
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe("message.delta")
    expect(events[1].type).toBe("message.delta")
    expect(events[2].type).toBe("run.completed")
  })

  test("ignores unknown event types", async () => {
    const raw = 'event: unknown.event\ndata: {"foo":"bar"}\n\n'
    const response = makeSSEResponse(raw)
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(0)
  })

  test("handles known event types", async () => {
    const knownTypes = [
      "message.delta",
      "tool.start",
      "tool.end",
      "run.completed",
      "run.failed",
      "run.cancelled",
      "status",
      "run.started",
      "heartbeat",
    ]

    for (const type of knownTypes) {
      const response = makeSSEResponse(
        `event: ${type}\ndata: {"test":true}\n\n`,
      )
      const events = []
      for await (const event of parseSSEStream(response)) {
        events.push(event)
      }
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe(type)
    }
  })

  test("handles chunked delivery across event boundaries", async () => {
    const response = makeChunkedSSEResponse([
      'event: message.delta\ndata: {"con',
      'tent":"hello"}\n\nevent: run.comp',
      'leted\ndata: {"duration_ms":50}\n\n',
    ])
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("message.delta")
    expect(events[1].type).toBe("run.completed")
  })

  test("handles invalid JSON gracefully", async () => {
    const response = makeSSEResponse(
      "event: message.delta\ndata: not-json\n\n",
    )
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0].data).toEqual({ raw: "not-json" })
  })

  test("handles empty response body", async () => {
    const response = new Response(null)
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(0)
  })

  test("handles carriage return in line endings", async () => {
    const response = makeSSEResponse(
      'event: message.delta\r\ndata: {"content":"hi"}\r\n\r\n',
    )
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0].data).toEqual({ content: "hi" })
  })

  test("handles multi-line data fields", async () => {
    const response = makeSSEResponse(
      'event: message.delta\ndata: {"content":\ndata: "hello"}\n\n',
    )
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    // Multi-line data gets joined with \n and parsed
    expect(events[0].data).toEqual({ content: "hello" })
  })

  test("flushes trailing event with final newline but no blank line", async () => {
    const response = makeSSEResponse(
      'event: message.delta\ndata: {"content":"end"}\n',
    )
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    // Data line is parsed (has trailing \n), and flushed at stream end
    expect(events).toHaveLength(1)
    expect(events[0].data).toEqual({ content: "end" })
  })

  test("parses tool events", async () => {
    const raw = [
      'event: tool.start\ndata: {"tool":"bash","input":{"command":"ls"}}\n\n',
      'event: tool.end\ndata: {"duration_ms":250}\n\n',
    ].join("")

    const response = makeSSEResponse(raw)
    const events = []
    for await (const event of parseSSEStream(response)) {
      events.push(event)
    }
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("tool.start")
    expect(events[0].data).toEqual({ tool: "bash", input: { command: "ls" } })
    expect(events[1].type).toBe("tool.end")
    expect(events[1].data).toEqual({ duration_ms: 250 })
  })
})
