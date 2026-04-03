import { describe, expect, test } from "bun:test"
import { parseSSEStream } from "../../src/api/streaming"

function sseResponse(body: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

async function collectEvents(response: Response) {
  const events = []
  for await (const event of parseSSEStream(response)) {
    events.push(event)
  }
  return events
}

describe("parseSSEStream", () => {
  test("parses a single SSE event", async () => {
    const response = sseResponse('data: {"stdout":"hello"}\n\n')
    const events = await collectEvents(response)

    expect(events).toEqual([{ stdout: "hello" }])
  })

  test("parses multiple SSE events", async () => {
    const body = [
      'data: {"stdout":"line1\\n"}',
      "",
      'data: {"stderr":"warn"}',
      "",
      'data: {"exit_code":0,"finished":true}',
      "",
      "",
    ].join("\n")

    const events = await collectEvents(sseResponse(body))

    expect(events).toEqual([
      { stdout: "line1\n" },
      { stderr: "warn" },
      { exit_code: 0, finished: true },
    ])
  })

  test("skips malformed JSON lines", async () => {
    const body = [
      'data: {"stdout":"ok"}',
      "",
      "data: {not valid json",
      "",
      'data: {"finished":true}',
      "",
      "",
    ].join("\n")

    const events = await collectEvents(sseResponse(body))

    expect(events).toEqual([{ stdout: "ok" }, { finished: true }])
  })

  test("skips lines without data: prefix", async () => {
    const body = [
      "event: message",
      'data: {"stdout":"hi"}',
      "",
      ": comment line",
      'data: {"finished":true}',
      "",
      "",
    ].join("\n")

    const events = await collectEvents(sseResponse(body))

    expect(events).toEqual([{ stdout: "hi" }, { finished: true }])
  })

  test("returns no events for empty body", async () => {
    const response = new Response(null, { status: 200 })
    const events = await collectEvents(response)

    expect(events).toEqual([])
  })

  test("handles data split across chunks", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // Split a single event across two chunks
        controller.enqueue(encoder.encode('data: {"std'))
        controller.enqueue(encoder.encode('out":"split"}\n\n'))
        controller.close()
      },
    })
    const response = new Response(stream, { status: 200 })
    const events = await collectEvents(response)

    expect(events).toEqual([{ stdout: "split" }])
  })

  test("handles trailing data without final newline", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"finished":true}'))
        controller.close()
      },
    })
    const response = new Response(stream, { status: 200 })
    const events = await collectEvents(response)

    expect(events).toEqual([{ finished: true }])
  })
})
