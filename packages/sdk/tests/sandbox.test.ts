import { afterEach, describe, expect, it, vi } from "vitest"

import { Sandbox } from "../src/Sandbox.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(
  status: number,
  code = "error",
  message = "boom",
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseSandbox = {
  id: "sbx-1",
  name: "my-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 512,
  access_token: "tok-abc",
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Sandbox statics", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Sandbox.create posts to /sandboxes with correct body", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.create({
      ...commonOpts,
      name: "my-sandbox",
      metadata: { env: "test" },
    })
    expect(sandbox.id).toBe("sbx-1")
    expect(sandbox.status).toBe("active")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["X-API-Key"]).toBe("ss_live_test")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "my-sandbox", metadata: { env: "test" } })
  })

  it("Sandbox.create throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(
      Sandbox.create({ ...commonOpts, name: "no-token" }),
    ).rejects.toThrow(/missing access_token/)
  })

  it("Sandbox.connect fetches and returns instance", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)

    const sandbox = await Sandbox.connect("sbx-1", commonOpts)
    expect(sandbox.id).toBe("sbx-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1")
    expect(init.method).toBe("GET")
  })

  it("Sandbox.connect throws when access_token missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...baseSandbox, access_token: undefined }),
      ),
    )
    await expect(Sandbox.connect("sbx-1", commonOpts)).rejects.toThrow(
      /missing access_token/,
    )
  })

  it("Sandbox.list returns an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([baseSandbox, { ...baseSandbox, id: "sbx-2" }]),
      ),
    )

    const list = await Sandbox.list(commonOpts)
    expect(list).toHaveLength(2)
    expect(list[0]?.id).toBe("sbx-1")
    expect(list[1]?.id).toBe("sbx-2")
  })

  it("Sandbox.list appends metadata filters to URL", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Sandbox.list({
      ...commonOpts,
      metadata: { env: "prod", tier: "gold" },
    })
    const [url] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("metadata.env=prod")
    expect(url).toContain("metadata.tier=gold")
  })

  it("Sandbox.killById swallows 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).resolves.toBeUndefined()
  })

  it("Sandbox.killById propagates non-404 errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "server_error", "boom")),
    )

    await expect(Sandbox.killById("sbx-1", commonOpts)).rejects.toThrow()
  })
})

describe("Sandbox instance methods", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function makeSandbox(): Promise<Sandbox> {
    const mock = vi.fn(async () => jsonResponse(baseSandbox))
    vi.stubGlobal("fetch", mock)
    const sandbox = await Sandbox.create({ ...commonOpts, name: "test" })
    vi.unstubAllGlobals()
    return sandbox
  }

  it("sandbox.kill swallows 404", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found", "gone")),
    )
    await expect(sandbox.kill()).resolves.toBeUndefined()
  })

  it("sandbox.pause returns void and posts to /pause", async () => {
    const sandbox = await makeSandbox()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    const result = await sandbox.pause()
    expect(result).toBeUndefined()

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/pause")
    expect(init.method).toBe("POST")
  })

  it("sandbox.resume rotates access token and rebuilds files sub-module", async () => {
    const sandbox = await makeSandbox()
    const filesBefore = sandbox.files

    // Capture the new token when it flows through to a subsequent files.write
    const resumeMock = vi.fn(async () =>
      jsonResponse({
        id: "sbx-1",
        status: "active",
        access_token: "tok-new",
      }),
    )
    vi.stubGlobal("fetch", resumeMock)

    const result = await sandbox.resume()
    expect(result).toBeUndefined()

    const [url, init] = resumeMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/sandboxes/sbx-1/resume")
    expect(init.method).toBe("POST")

    // Files sub-module was rebuilt (new instance)
    expect(sandbox.files).not.toBe(filesBefore)

    // Verify subsequent file ops use the rotated token
    vi.unstubAllGlobals()
    const writeMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", writeMock)
    await sandbox.files.write("/tmp/x", "hi")
    const [, writeInit] = writeMock.mock.calls[0] as [string, RequestInit]
    const headers = writeInit.headers as Record<string, string>
    expect(headers["X-Access-Token"]).toBe("tok-new")
  })

  it("sandbox.resume throws when access_token missing", async () => {
    const sandbox = await makeSandbox()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ id: "sbx-1", status: "active" }),
      ),
    )
    await expect(sandbox.resume()).rejects.toThrow(/missing access_token/)
  })
})
