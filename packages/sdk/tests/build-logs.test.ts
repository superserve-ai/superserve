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

const buildBase = {
  id: "b-1",
  template_id: "t-1",
  build_spec_hash: "h",
  created_at: "2026-01-01T00:00:00Z",
}

/**
 * Build a URL-aware fetch mock so concurrent SSE + polling don't depend
 * on call order. Each handler matches by URL substring.
 */
function urlFetchMock(
  handlers: Array<{ match: string; respond: () => Response }>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    for (const { match, respond } of handlers) {
      if (url.includes(match)) return respond()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
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

  it("resolves when build poll returns 'ready'", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response(sseStream([]), { status: 200 }),
        },
        {
          match: "/builds/b-1",
          respond: () => jsonResponse({ ...buildBase, status: "ready" }),
        },
        {
          match: "/templates/t-1",
          respond: () => jsonResponse({ ...baseTemplate, status: "ready" }),
        },
      ]),
    )

    const info = await t.waitUntilReady({ pollIntervalMs: 1 })
    expect(info.status).toBe("ready")
  })

  it("forwards SSE log events through onLog", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () =>
            new Response(
              sseStream([
                'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"stdout","text":"built"}',
                "",
                'data: {"timestamp":"2026-01-01T00:00:01Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                "",
              ]),
              { status: 200 },
            ),
        },
        {
          match: "/builds/b-1",
          respond: () => jsonResponse({ ...buildBase, status: "ready" }),
        },
        {
          match: "/templates/t-1",
          respond: () => jsonResponse({ ...baseTemplate, status: "ready" }),
        },
      ]),
    )

    const logs: string[] = []
    const info = await t.waitUntilReady({
      pollIntervalMs: 1,
      onLog: (ev) => logs.push(ev.text),
    })
    expect(info.status).toBe("ready")
    expect(logs).toContain("built")
  })

  it("ignores SSE-reported 'ready' while build poll still says 'building' (race)", async () => {
    // Regression: SSE sends `finished:true,status:"ready"` the instant
    // vmd finishes, but the DB row that POST /sandboxes reads is updated
    // by a separate ~1s poller. The SDK must trust the build poll, not
    // the SSE event — otherwise callers race to POST /sandboxes and hit
    // 409 "template is not ready". The previous SDK trusted SSE here and
    // returned with `info.status: "building"`.
    const t = await makeTemplate()
    let buildCalls = 0
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () =>
            new Response(
              sseStream([
                'data: {"timestamp":"2026-01-01T00:00:00Z","stream":"system","text":"done","finished":true,"status":"ready"}',
                "",
              ]),
              { status: 200 },
            ),
        },
        {
          match: "/builds/b-1",
          respond: () => {
            buildCalls++
            const status = buildCalls < 3 ? "building" : "ready"
            return jsonResponse({ ...buildBase, status })
          },
        },
        {
          match: "/templates/t-1",
          respond: () => jsonResponse({ ...baseTemplate, status: "ready" }),
        },
      ]),
    )

    // Pass `onLog` so SSE actually opens — without it the SDK skips SSE
    // entirely and the test wouldn't exercise the SSE-says-ready path.
    const info = await t.waitUntilReady({
      pollIntervalMs: 1,
      onLog: () => {},
    })
    expect(info.status).toBe("ready")
    expect(buildCalls).toBeGreaterThanOrEqual(3)
  })

  it("throws BuildError when build poll returns 'failed'", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response(sseStream([]), { status: 200 }),
        },
        {
          match: "/builds/b-1",
          respond: () =>
            jsonResponse({
              ...buildBase,
              status: "failed",
              error_message:
                "step_failed: step 1/1 failed after 3s: exited with code 100",
            }),
        },
      ]),
    )

    await expect(t.waitUntilReady({ pollIntervalMs: 1 })).rejects.toMatchObject(
      {
        name: "BuildError",
        code: "step_failed",
        buildId: "b-1",
        templateId: "t-1",
      },
    )
  })

  it("throws ConflictError when build poll returns 'cancelled'", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response(sseStream([]), { status: 200 }),
        },
        {
          match: "/builds/b-1",
          respond: () => jsonResponse({ ...buildBase, status: "cancelled" }),
        },
      ]),
    )

    await expect(
      t.waitUntilReady({ pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("treats SSE failures as non-fatal — polling drives terminal detection", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response("", { status: 500 }),
        },
        {
          match: "/builds/b-1",
          respond: () => jsonResponse({ ...buildBase, status: "ready" }),
        },
        {
          match: "/templates/t-1",
          respond: () => jsonResponse({ ...baseTemplate, status: "ready" }),
        },
      ]),
    )

    const info = await t.waitUntilReady({
      pollIntervalMs: 1,
      onLog: () => {},
    })
    expect(info.status).toBe("ready")
  })

  it("BuildError separates code from message when error_message is prefixed", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response(sseStream([]), { status: 200 }),
        },
        {
          match: "/builds/b-1",
          respond: () =>
            jsonResponse({
              ...buildBase,
              status: "failed",
              error_message:
                "image_too_large: image is too large for the requested disk_mib",
            }),
        },
      ]),
    )

    await expect(t.waitUntilReady({ pollIntervalMs: 1 })).rejects.toMatchObject(
      {
        name: "BuildError",
        code: "image_too_large",
        message: "image is too large for the requested disk_mib",
      },
    )
  })

  it("BuildError uses generic message when error_message is missing", async () => {
    const t = await makeTemplate()
    vi.stubGlobal(
      "fetch",
      urlFetchMock([
        {
          match: "/builds/b-1/logs",
          respond: () => new Response(sseStream([]), { status: 200 }),
        },
        {
          match: "/builds/b-1",
          respond: () => jsonResponse({ ...buildBase, status: "failed" }),
        },
      ]),
    )

    await expect(t.waitUntilReady({ pollIntervalMs: 1 })).rejects.toMatchObject(
      {
        name: "BuildError",
        code: "build_failed",
        message: "Template build failed",
      },
    )
  })
})
