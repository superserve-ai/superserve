import { afterEach, describe, expect, it, vi } from "vitest"
import { NotFoundError } from "../src/errors.js"
import { Template } from "../src/Template.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

function errorResponse(status: number, code = "error", message = "boom"): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
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

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Template.create", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("POSTs /templates with flattened BuildSpec", async () => {
    const mock = vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" }))
    vi.stubGlobal("fetch", mock)

    const template = await Template.create({
      ...commonOpts,
      alias: "my-env",
      vcpu: 2,
      memoryMib: 2048,
      diskMib: 4096,
      from: "python:3.11",
      steps: [{ run: "pip install numpy" }, { env: { key: "DEBUG", value: "1" } }],
      startCmd: "python server.py",
      readyCmd: "curl -f http://localhost:8080/",
    })

    expect(template.id).toBe("t-1")
    expect(template.alias).toBe("my-env")
    expect(template.latestBuildId).toBe("b-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      alias: "my-env",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 4096,
      build_spec: {
        from: "python:3.11",
        steps: [
          { run: "pip install numpy" },
          { env: { key: "DEBUG", value: "1" } },
        ],
        start_cmd: "python server.py",
        ready_cmd: "curl -f http://localhost:8080/",
      },
    })
  })

  it("omits resource fields and start/ready when not provided", async () => {
    const mock = vi.fn(async () => jsonResponse({ ...baseTemplate, build_id: "b-1" }))
    vi.stubGlobal("fetch", mock)

    await Template.create({ ...commonOpts, alias: "x", from: "python:3.11" })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ alias: "x", build_spec: { from: "python:3.11" } })
  })

  it("throws when build_id missing from response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(baseTemplate)))
    await expect(
      Template.create({ ...commonOpts, alias: "x", from: "python:3.11" }),
    ).rejects.toThrow(/missing build_id/)
  })
})

describe("Template.connect", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /templates/{id}", async () => {
    const mock = vi.fn(async () => jsonResponse(baseTemplate))
    vi.stubGlobal("fetch", mock)

    const template = await Template.connect("my-env", commonOpts)

    expect(template.id).toBe("t-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/my-env")
    expect(init.method).toBe("GET")
  })
})

describe("Template.list", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /templates without filter", async () => {
    const mock = vi.fn(async () => jsonResponse([baseTemplate]))
    vi.stubGlobal("fetch", mock)

    const list = await Template.list(commonOpts)
    expect(list).toHaveLength(1)
    expect(list[0].alias).toBe("my-env")
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates")
  })

  it("appends alias_prefix query param", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Template.list({ ...commonOpts, aliasPrefix: "my-" })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates?alias_prefix=my-")
  })
})

describe("Template.deleteById", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("DELETEs /templates/{id}", async () => {
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await Template.deleteById("my-env", commonOpts)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/my-env")
    expect(init.method).toBe("DELETE")
  })

  it("swallows 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(404, "not_found")))
    await expect(Template.deleteById("missing", commonOpts)).resolves.toBeUndefined()
  })

  it("throws other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(409, "conflict")))
    await expect(Template.deleteById("busy", commonOpts)).rejects.toThrow()
  })
})

describe("Template instance methods", () => {
  afterEach(() => vi.unstubAllGlobals())

  const fullTemplate = { ...baseTemplate, build_id: "b-1" }

  async function createTemplate() {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fullTemplate)))
    const t = await Template.create({ ...commonOpts, alias: "my-env", from: "python:3.11" })
    vi.unstubAllGlobals()
    return t
  }

  it("getInfo refreshes from GET /templates/{id}", async () => {
    const t = await createTemplate()
    const updated = { ...baseTemplate, status: "ready" }
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(updated)))

    const info = await t.getInfo()
    expect(info.status).toBe("ready")
  })

  it("delete DELETEs the template (idempotent on 404)", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => errorResponse(404, "not_found"))
    vi.stubGlobal("fetch", mock)

    await expect(t.delete()).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("delete throws on 409 (has active sandboxes)", async () => {
    const t = await createTemplate()
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(409, "conflict")))
    await expect(t.delete()).rejects.toThrow()
  })

  it("rebuild POSTs /templates/{id}/builds", async () => {
    const t = await createTemplate()
    const build = {
      id: "b-2",
      template_id: "t-1",
      status: "building",
      build_spec_hash: "h",
      created_at: "2026-01-01T00:00:00Z",
    }
    const mock = vi.fn(async () => jsonResponse(build, 201))
    vi.stubGlobal("fetch", mock)

    const info = await t.rebuild()
    expect(info.id).toBe("b-2")
    expect(info.templateId).toBe("t-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds")
    expect(init.method).toBe("POST")
  })

  it("listBuilds GETs with optional limit", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await t.listBuilds({ limit: 5 })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds?limit=5")
  })

  it("getBuild GETs /templates/{id}/builds/{build_id}", async () => {
    const t = await createTemplate()
    const build = {
      id: "b-1",
      template_id: "t-1",
      status: "building",
      build_spec_hash: "h",
      created_at: "2026-01-01T00:00:00Z",
    }
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(build)))

    const info = await t.getBuild("b-1")
    expect(info.id).toBe("b-1")
  })

  it("cancelBuild DELETEs the build", async () => {
    const t = await createTemplate()
    const mock = vi.fn(async () => noContentResponse())
    vi.stubGlobal("fetch", mock)

    await t.cancelBuild("b-1")
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates/t-1/builds/b-1")
    expect(init.method).toBe("DELETE")
  })

  it("cancelBuild is idempotent on 404", async () => {
    const t = await createTemplate()
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(404, "not_found")))
    await expect(t.cancelBuild("b-1")).resolves.toBeUndefined()
  })
})
