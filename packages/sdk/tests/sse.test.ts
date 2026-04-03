import { describe, test, expect } from "bun:test"
import { parseSSEStream } from "../src/sse"

function makeSSEResponse(lines: string[]): Response {
  const text = lines.join("\n") + "\n"
  return new Response(text)
}

async function collectEvents<T>(response: Response): Promise<T[]> {
  const events: T[] = []
  for await (const event of parseSSEStream<T>(response)) {
    events.push(event)
  }
  return events
}

describe("parseSSEStream", () => {
  test("parses data lines as JSON", async () => {
    const response = makeSSEResponse([
      'data: {"type":"stdout","data":"hello"}',
      'data: {"type":"stderr","data":"warn"}',
    ])

    const events = await collectEvents<{ type: string; data: string }>(response)
    expect(events).toEqual([
      { type: "stdout", data: "hello" },
      { type: "stderr", data: "warn" },
    ])
  })

  test("skips non-data lines (comments, event types, empty lines)", async () => {
    const response = makeSSEResponse([
      ": this is a comment",
      "event: message",
      "",
      'data: {"value":1}',
      "id: 123",
      'data: {"value":2}',
    ])

    const events = await collectEvents<{ value: number }>(response)
    expect(events).toEqual([{ value: 1 }, { value: 2 }])
  })

  test("skips malformed JSON in data lines", async () => {
    const response = makeSSEResponse([
      "data: not-json",
      'data: {"valid":true}',
      "data: {broken",
    ])

    const events = await collectEvents<{ valid: boolean }>(response)
    expect(events).toEqual([{ valid: true }])
  })

  test("returns no events for empty body", async () => {
    const response = new Response(null)
    const events = await collectEvents(response)
    expect(events).toEqual([])
  })

  test("handles data line without trailing newline (remaining buffer)", async () => {
    // Simulate a response where the last data line has no trailing newline
    const text = 'data: {"last":true}'
    const response = new Response(text)

    const events = await collectEvents<{ last: boolean }>(response)
    expect(events).toEqual([{ last: true }])
  })

  test("handles \\r\\n line endings", async () => {
    const text = 'data: {"a":1}\r\ndata: {"b":2}\r\n'
    const response = new Response(text)

    const events = await collectEvents<Record<string, number>>(response)
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })
})
