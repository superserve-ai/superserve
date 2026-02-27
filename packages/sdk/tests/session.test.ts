import { describe, expect, mock, test } from "bun:test"
import { Session } from "../src/session"
import type { SessionInfo } from "../src/types"

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

const sessionInfo: SessionInfo = {
  id: "ses_123",
  agentId: "agt_456",
  status: "active",
  messageCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
}

describe("Session", () => {
  test("exposes id and agentId", () => {
    const requestFn = mock(() => Promise.resolve(new Response()))
    const safeJsonFn = mock(() => Promise.resolve({}))
    const session = new Session(sessionInfo, requestFn, safeJsonFn)

    expect(session.id).toBe("ses_123")
    expect(session.agentId).toBe("agt_456")
    expect(session.info).toEqual(sessionInfo)
  })

  test("run sends message and returns result", async () => {
    const sseResponse = makeSSEResponse([
      { type: "message.delta", data: { content: "response text" } },
      { type: "run.completed", data: { duration_ms: 150 } },
    ])
    const requestFn = mock(() => Promise.resolve(sseResponse))
    const safeJsonFn = mock(() => Promise.resolve({}))
    const session = new Session(sessionInfo, requestFn, safeJsonFn)

    const result = await session.run("hello")

    expect(result.text).toBe("response text")
    expect(result.finishReason).toBe("completed")
    expect(result.duration).toBe(150)
    expect(requestFn).toHaveBeenCalledWith(
      "POST",
      "/sessions/ses_123/messages",
      expect.objectContaining({
        json: { prompt: "hello" },
        stream: true,
      }),
    )
  })

  test("stream returns an AgentStream", async () => {
    const sseResponse = makeSSEResponse([
      { type: "message.delta", data: { content: "streamed" } },
      { type: "run.completed", data: { duration_ms: 50 } },
    ])
    const requestFn = mock(() => Promise.resolve(sseResponse))
    const safeJsonFn = mock(() => Promise.resolve({}))
    const session = new Session(sessionInfo, requestFn, safeJsonFn)

    const stream = session.stream("hello")
    const result = await stream.result

    expect(result.text).toBe("streamed")
  })

  test("stream passes callbacks through", async () => {
    const sseResponse = makeSSEResponse([
      { type: "message.delta", data: { content: "text" } },
      { type: "run.completed", data: { duration_ms: 10 } },
    ])
    const requestFn = mock(() => Promise.resolve(sseResponse))
    const safeJsonFn = mock(() => Promise.resolve({}))
    const session = new Session(sessionInfo, requestFn, safeJsonFn)

    const onText = mock(() => {})
    const stream = session.stream("hello", { onText })
    await stream.result

    expect(onText).toHaveBeenCalledWith("text")
  })

  test("end sends POST to session end endpoint", async () => {
    const requestFn = mock(() => Promise.resolve(new Response()))
    const safeJsonFn = mock(() => Promise.resolve({}))
    const session = new Session(sessionInfo, requestFn, safeJsonFn)

    await session.end()

    expect(requestFn).toHaveBeenCalledWith("POST", "/sessions/ses_123/end")
  })
})
