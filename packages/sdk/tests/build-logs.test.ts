import { afterEach, describe, expect, it, vi } from "vitest"
import { ConflictError } from "../src/errors.js"
import { Template } from "../src/Template.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function sseStream(lines: string[]): ReadableStream {
  const payload = lines.join("\n") + "\n"
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
}

const baseTemplate = {
  id: "t-1",
  team_id: "team-1",
  alias: "my-env",
  status: "building",
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: "2026-01-01T00:00:00Z",
}
const commonOpts = { apiKey: "k", baseUrl: "https://api.superserve.ai" }

async function makeTemplate() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" })),
  )
  const t = await Template.create({
    ...commonOpts,
    alias: "my-env",
    from: "python:3.11",
  })
  vi.unstubAllGlobals()
  return t
}

describe("Template.streamBuildLogs", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /logs and forwards events via onEvent", async () => {
    const t = await makeTemplate()
    const stream = sseStream([
      'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"hello"}',
      "",
      'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
      "",
    ])
    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    const events: Array<{ stream: string; text: string }> = []
    await t.streamBuildLogs({
      onEvent: (ev) => events.push({ stream: ev.stream, text: ev.text }),
    })

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-1/logs")
    expect(init.method).toBe("GET")
    expect(events).toEqual([
      { stream: "stdout", text: "hello" },
      { stream: "system", text: "done" },
    ])
  })

  it("uses provided buildId when passed", async () => {
    const t = await makeTemplate()
    const stream = sseStream([])
    const mock = vi.fn(async () => new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", mock)

    await t.streamBuildLogs({ onEvent: () => {}, buildId: "b-2" })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-2/logs")
  })

  it("falls back to listBuilds when latestBuildId is unset (e.g. after connect)", async () => {
    // Connect: no build_id in response → latestBuildId is undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseTemplate)),
    )
    const t = await Template.connect("my-env", commonOpts)
    vi.unstubAllGlobals()

    // streamBuildLogs should call listBuilds first, then SSE.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse([
          {
            id: "b-recent",
            template_id: "t-1",
            status: "ready",
            build_spec_hash: "h",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]),
      )
      .mockImplementationOnce(
        async () => new Response(sseStream([]), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await t.streamBuildLogs({ onEvent: () => {} })
    const [listUrl] = fetchMock.mock.calls[0] as [string]
    const [streamUrl] = fetchMock.mock.calls[1] as [string]
    expect(listUrl).toBe(
      "https://api.superserve.ai/templates/t-1/builds?limit=1",
    )
    expect(streamUrl).toBe(
      "https://api.superserve.ai/templates/t-1/builds/b-recent/logs",
    )
  })

  it("throws helpful error when template has no builds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseTemplate)),
    )
    const t = await Template.connect("my-env", commonOpts)
    vi.unstubAllGlobals()

    // listBuilds returns empty
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    )

    await expect(t.streamBuildLogs({ onEvent: () => {} })).rejects.toThrow(
      /has no builds — call rebuild/,
    )
  })
})

describe("Template.waitUntilReady", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("resolves when SSE final event has status 'ready'", async () => {
    const t = await makeTemplate()
    const readyTemplate = { ...baseTemplate, status: "ready" }

    // First fetch: SSE stream; second fetch: getInfo refresh
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(
            sseStream([
              'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"built"}',
              "",
              'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
              "",
            ]),
            { status: 200 },
          ),
      )
      .mockImplementationOnce(async () => jsonResponse(readyTemplate))
    vi.stubGlobal("fetch", fetchMock)

    const logs: string[] = []
    const info = await t.waitUntilReady({ onLog: (ev) => logs.push(ev.text) })
    expect(info.status).toBe("ready")
    expect(logs).toContain("built")
  })

  it("throws BuildError when SSE final event has status 'failed'", async () => {
    const t = await makeTemplate()
    const failedTemplate = {
      ...baseTemplate,
      status: "failed",
      error_message:
        "step_failed: step 1/1 failed after 3s: exited with code 100",
    }
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(
            sseStream([
              'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"failed","finished":true,"status":"failed"}',
              "",
            ]),
            { status: 200 },
          ),
      )
      .mockImplementationOnce(async () => jsonResponse(failedTemplate))
    vi.stubGlobal("fetch", fetchMock)

    await expect(t.waitUntilReady()).rejects.toMatchObject({
      name: "BuildError",
      code: "step_failed",
      buildId: "b-1",
      templateId: "t-1",
    })
  })

  it("throws ConflictError on status 'cancelled'", async () => {
    const t = await makeTemplate()
    const cancelledTemplate = { ...baseTemplate, status: "failed" }
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(
            sseStream([
              'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"cancelled","finished":true,"status":"cancelled"}',
              "",
            ]),
            { status: 200 },
          ),
      )
      .mockImplementationOnce(async () => jsonResponse(cancelledTemplate))
    vi.stubGlobal("fetch", fetchMock)

    await expect(t.waitUntilReady()).rejects.toBeInstanceOf(ConflictError)
  })

  it("falls back to polling when SSE errors", async () => {
    const t = await makeTemplate()
    const readyTemplate = { ...baseTemplate, status: "ready" }

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("network")
      })
      .mockImplementationOnce(async () => jsonResponse(readyTemplate))
    vi.stubGlobal("fetch", fetchMock)

    const info = await t.waitUntilReady({ pollIntervalMs: 1 })
    expect(info.status).toBe("ready")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
