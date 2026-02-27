import { afterEach, describe, expect, mock, test } from "bun:test"
import { Superserve } from "../src/client"
import { APIError, SuperserveError } from "../src/errors"

const originalFetch = globalThis.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init)),
  ) as typeof fetch
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sseResponse(events: { type: string; data: unknown }[]): Response {
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

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Superserve constructor", () => {
  test("sets default base URL and timeout", () => {
    const client = new Superserve({ apiKey: "test-key" })
    // Verify via a request that uses the base URL
    mockFetch((url) => {
      expect(url).toStartWith("https://api.superserve.ai/v1/")
      return jsonResponse({ agents: [] })
    })
    client.agents.list()
  })

  test("accepts custom base URL", () => {
    const client = new Superserve({
      apiKey: "test-key",
      baseUrl: "https://custom.api.com/",
    })
    mockFetch((url) => {
      expect(url).toStartWith("https://custom.api.com/v1/")
      return jsonResponse({ agents: [] })
    })
    client.agents.list()
  })

  test("strips trailing slashes from base URL", () => {
    const client = new Superserve({
      apiKey: "test-key",
      baseUrl: "https://custom.api.com///",
    })
    mockFetch((url) => {
      expect(url).toStartWith("https://custom.api.com/v1/")
      return jsonResponse({ agents: [] })
    })
    client.agents.list()
  })
})

describe("agents.list", () => {
  test("returns mapped agents", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch(() =>
      jsonResponse({
        agents: [
          {
            id: "agt_1",
            name: "my-agent",
            command: "python main.py",
            deps_status: "ready",
            deps_error: null,
            required_secrets: ["API_KEY"],
            environment_keys: [],
            created_at: "2026-01-01",
            updated_at: "2026-01-02",
          },
        ],
      }),
    )

    const agents = await client.agents.list()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe("agt_1")
    expect(agents[0].name).toBe("my-agent")
    expect(agents[0].depsStatus).toBe("ready")
    expect(agents[0].requiredSecrets).toEqual(["API_KEY"])
  })

  test("returns empty array when no agents", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch(() => jsonResponse({}))

    const agents = await client.agents.list()
    expect(agents).toEqual([])
  })
})

describe("agents.get", () => {
  test("fetches agent by ID", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch((url) => {
      if (url.includes("/agents/agt_1")) {
        return jsonResponse({
          id: "agt_1",
          name: "my-agent",
          command: "python main.py",
          deps_status: "ready",
          deps_error: null,
          required_secrets: [],
          environment_keys: [],
          created_at: "2026-01-01",
          updated_at: "2026-01-02",
        })
      }
      return jsonResponse({ agents: [] })
    })

    const agent = await client.agents.get("agt_1")
    expect(agent.id).toBe("agt_1")
    expect(agent.name).toBe("my-agent")
  })

  test("resolves agent by name", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch((url) => {
      if (url.endsWith("/agents")) {
        return jsonResponse({
          agents: [
            {
              id: "agt_1",
              name: "my-agent",
              command: null,
              deps_status: "ready",
              deps_error: null,
              required_secrets: [],
              environment_keys: [],
              created_at: "2026-01-01",
              updated_at: "2026-01-02",
            },
          ],
        })
      }
      return jsonResponse({
        id: "agt_1",
        name: "my-agent",
        command: null,
        deps_status: "ready",
        deps_error: null,
        required_secrets: [],
        environment_keys: [],
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      })
    })

    const agent = await client.agents.get("my-agent")
    expect(agent.id).toBe("agt_1")
  })

  test("throws 404 for unknown agent name", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch(() => jsonResponse({ agents: [] }))

    expect(client.agents.get("nonexistent")).rejects.toThrow(APIError)
  })
})

describe("createSession", () => {
  test("creates a session for an agent", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch((url) => {
      if (url.endsWith("/agents")) {
        return jsonResponse({
          agents: [
            {
              id: "agt_1",
              name: "my-agent",
              command: null,
              deps_status: "ready",
              deps_error: null,
              required_secrets: [],
              environment_keys: [],
              created_at: "",
              updated_at: "",
            },
          ],
        })
      }
      return jsonResponse({
        id: "ses_abc",
        agent_id: "agt_1",
        status: "active",
        message_count: 0,
        created_at: "2026-01-01",
      })
    })

    const session = await client.createSession("my-agent")
    expect(session.id).toBe("ses_abc")
    expect(session.agentId).toBe("agt_1")
  })
})

describe("run", () => {
  test("creates session, sends message, and ends session", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    const calls: string[] = []

    mockFetch((url) => {
      if (url.endsWith("/agents")) {
        calls.push("list-agents")
        return jsonResponse({
          agents: [
            {
              id: "agt_1",
              name: "my-agent",
              command: null,
              deps_status: "ready",
              deps_error: null,
              required_secrets: [],
              environment_keys: [],
              created_at: "",
              updated_at: "",
            },
          ],
        })
      }
      if (url.endsWith("/sessions") && !url.includes("/messages")) {
        calls.push("create-session")
        return jsonResponse({
          id: "ses_abc",
          agent_id: "agt_1",
          status: "active",
          message_count: 0,
          created_at: "2026-01-01",
        })
      }
      if (url.includes("/messages")) {
        calls.push("send-message")
        return sseResponse([
          { type: "message.delta", data: { content: "response" } },
          { type: "run.completed", data: { duration_ms: 100 } },
        ])
      }
      if (url.includes("/end")) {
        calls.push("end-session")
        return jsonResponse({})
      }
      return jsonResponse({})
    })

    const result = await client.run("my-agent", { message: "hello" })

    expect(result.text).toBe("response")
    expect(calls).toContain("create-session")
    expect(calls).toContain("send-message")
    expect(calls).toContain("end-session")
  })

  test("uses existing session when sessionId provided", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch((url) => {
      if (url.includes("/sessions/ses_existing/messages")) {
        return sseResponse([
          { type: "message.delta", data: { content: "from existing" } },
          { type: "run.completed", data: { duration_ms: 50 } },
        ])
      }
      return jsonResponse({})
    })

    const result = await client.run("my-agent", {
      message: "hello",
      sessionId: "ses_existing",
    })
    expect(result.text).toBe("from existing")
  })
})

describe("API error handling", () => {
  test("throws APIError on 4xx response", async () => {
    const client = new Superserve({ apiKey: "bad-key" })
    mockFetch(() =>
      jsonResponse({ detail: "Unauthorized" }, 401),
    )

    try {
      await client.agents.list()
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(APIError)
      expect((e as APIError).status).toBe(401)
      expect((e as APIError).message).toBe("Unauthorized")
    }
  })

  test("throws APIError on 5xx response", async () => {
    const client = new Superserve({ apiKey: "test-key" })
    mockFetch(() => jsonResponse({ message: "Internal error" }, 500))

    try {
      await client.agents.list()
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(APIError)
      expect((e as APIError).status).toBe(500)
    }
  })

  test("sends authorization header", async () => {
    const client = new Superserve({ apiKey: "my-secret-key" })
    mockFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe("Bearer my-secret-key")
      return jsonResponse({ agents: [] })
    })

    await client.agents.list()
  })
})
