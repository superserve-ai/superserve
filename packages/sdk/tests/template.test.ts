import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AuthenticationError,
  NotFoundError,
  ServerError,
} from "../src/errors.js"
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

const baseTemplate = {
  id: "t-1",
  team_id: "team-1",
  name: "my-env",
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
    const mock = vi.fn(async () =>
      jsonResponse({ ...baseTemplate, build_id: "b-1" }),
    )
    vi.stubGlobal("fetch", mock)

    const template = await Template.create({
      ...commonOpts,
      name: "my-env",
      vcpu: 2,
      memoryMib: 2048,
      memoryMaxMib: 8192,
      diskMib: 4096,
      from: "python:3.11",
      steps: [
        { run: "pip install numpy" },
        { env: { key: "DEBUG", value: "1" } },
      ],
      startCmd: "python server.py",
      readyCmd: "curl -f http://localhost:8080/",
    })

    expect(template.id).toBe("t-1")
    expect(template.name).toBe("my-env")
    expect(template.latestBuildId).toBe("b-1")

    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.superserve.ai/templates")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      name: "my-env",
      vcpu: 2,
      memory_mib: 2048,
      memory_max_mib: 8192,
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
    const mock = vi.fn(async () =>
      jsonResponse({ ...baseTemplate, build_id: "b-1" }),
    )
    vi.stubGlobal("fetch", mock)

    await Template.create({ ...commonOpts, name: "x", from: "python:3.11" })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ name: "x", build_spec: { from: "python:3.11" } })
  })

  it("throws when build_id missing from response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(baseTemplate)),
    )
    await expect(
      Template.create({ ...commonOpts, name: "x", from: "python:3.11" }),
    ).rejects.toThrow(/missing build_id/)
  })
})

describe("Template.connect", () => {
  afterEach(() => vi.unstubAllGlobals())

  const templateId = "11111111-2222-4aaa-8bbb-555555555555"

  it.each([
    templateId,
    templateId.toUpperCase(),
    templateId.replaceAll("-", ""),
    `urn:uuid:${templateId}`,
    `URN:UUID:${templateId.toUpperCase()}`,
    `{${templateId}}`,
  ])("GETs UUID reference %s directly without listing", async (reference) => {
    const mock = vi.fn(async () => jsonResponse(baseTemplate))
    vi.stubGlobal("fetch", mock)

    const template = await Template.connect(reference, commonOpts)

    expect(template.id).toBe("t-1")
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://api.superserve.ai/templates/${encodeURIComponent(reference)}`,
    )
    expect(init.method).toBe("GET")
  })

  it("preserves a UUID lookup's not-found error without name fallback", async () => {
    const mock = vi.fn(async () => errorResponse(404, "not_found"))
    vi.stubGlobal("fetch", mock)

    await expect(
      Template.connect(templateId, commonOpts),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it("resolves the exact team-owned name instead of a prefix neighbor", async () => {
    const mock = vi.fn(async () =>
      jsonResponse([
        { ...baseTemplate, id: "neighbor", name: "my-env-extra" },
        baseTemplate,
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const template = await Template.connect("my-env", commonOpts)

    expect(template.id).toBe(baseTemplate.id)
    expect(template.name).toBe("my-env")
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    const lookup = new URL(url)
    expect(lookup.pathname).toBe("/templates")
    expect(lookup.searchParams.get("name_prefix")).toBe("my-env")
    expect(lookup.searchParams.get("owner")).toBe("team")
    expect(init.method).toBe("GET")
    expect(new Headers(init.headers).get("X-API-Key")).toBe(commonOpts.apiKey)
  })

  it("falls back to the system owner and encodes namespaced names", async () => {
    const name = "superserve/node-22"
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ ...baseTemplate, name }]))
    vi.stubGlobal("fetch", mock)

    const template = await Template.connect(name, {
      ...commonOpts,
      baseUrl: "https://api-usw.superserve.ai",
    })

    expect(template.name).toBe(name)
    expect(mock).toHaveBeenCalledTimes(2)
    for (const [index, [url, init]] of mock.mock.calls.entries()) {
      const lookup = new URL(url)
      expect(lookup.origin).toBe("https://api-usw.superserve.ai")
      expect(lookup.pathname).toBe("/templates")
      expect(lookup.searchParams.get("name_prefix")).toBe(name)
      expect(lookup.searchParams.get("owner")).toBe(
        index === 0 ? "team" : "system",
      )
      expect(new Headers(init.headers).get("X-API-Key")).toBe(commonOpts.apiKey)
    }
  })

  it("rejects prefix and SQL wildcard neighbors as missing names", async () => {
    const mock = vi.fn(async () =>
      jsonResponse([
        { ...baseTemplate, name: "my-env-extra" },
        { ...baseTemplate, name: "myXenv" },
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const promise = Template.connect("my_env", commonOpts)
    await expect(promise).rejects.toBeInstanceOf(NotFoundError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found",
    })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it.each(["building", "failed"])(
    "connects to a %s template without enforcing readiness",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse([{ ...baseTemplate, status }])),
      )

      const template = await Template.connect("my-env", commonOpts)
      expect(template.status).toBe(status)
    },
  )

  it.each([
    { status: 401, errorType: AuthenticationError },
    { status: 403, errorType: AuthenticationError },
    { status: 500, errorType: ServerError },
  ])(
    "propagates a $status lookup error without trying another owner",
    async ({ status, errorType }) => {
      const mock = vi.fn(async () => errorResponse(status))
      vi.stubGlobal("fetch", mock)

      await expect(
        Template.connect("my-env", commonOpts),
      ).rejects.toBeInstanceOf(errorType)
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it("forwards cancellation to the system lookup", async () => {
    const controller = new AbortController()
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockImplementationOnce(async (_url, init: RequestInit) => {
        controller.abort()
        expect(init.signal?.aborted).toBe(true)
        throw init.signal?.reason
      })
    vi.stubGlobal("fetch", mock)

    await expect(
      Template.connect("my-env", { ...commonOpts, signal: controller.signal }),
    ).rejects.toMatchObject({
      message: "Request aborted",
      cause: { name: "AbortError" },
    })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it("can recover from duplicate creation and check readiness using the resolved UUID", async () => {
    const ready = { ...baseTemplate, id: templateId, status: "ready" }
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      const parsed = new URL(url)
      if (init.method === "POST" && parsed.pathname === "/templates") {
        return errorResponse(409, "conflict", "Template already exists")
      }
      if (parsed.pathname === "/templates") return jsonResponse([ready])
      if (parsed.pathname === `/templates/${templateId}/builds`) {
        return jsonResponse([])
      }
      if (parsed.pathname === `/templates/${templateId}`) {
        return jsonResponse(ready)
      }
      return errorResponse(400, "bad_request", "template_id must be a UUID")
    })
    vi.stubGlobal("fetch", mock)

    await expect(
      Template.create({ ...commonOpts, name: "my-env", from: "node:22" }),
    ).rejects.toMatchObject({ statusCode: 409 })
    const template = await Template.connect("my-env", commonOpts)
    const info = await template.waitUntilReady()

    expect(info.id).toBe(templateId)
    expect(info.status).toBe("ready")
    expect(mock.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain(
      "/templates/my-env",
    )
  })
})

describe("Template.list", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("GETs /templates without filter", async () => {
    const mock = vi.fn(async () => jsonResponse([baseTemplate]))
    vi.stubGlobal("fetch", mock)

    const list = await Template.list(commonOpts)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("my-env")
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates")
  })

  it("appends name_prefix query param", async () => {
    const mock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal("fetch", mock)

    await Template.list({ ...commonOpts, namePrefix: "my-" })
    const [url] = mock.mock.calls[0] as [string]
    expect(url).toBe("https://api.superserve.ai/templates?name_prefix=my-")
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found")),
    )
    await expect(
      Template.deleteById("missing", commonOpts),
    ).resolves.toBeUndefined()
  })

  it("throws other errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(409, "conflict")),
    )
    await expect(Template.deleteById("busy", commonOpts)).rejects.toThrow()
  })
})

describe("Template instance methods", () => {
  afterEach(() => vi.unstubAllGlobals())

  const fullTemplate = { ...baseTemplate, build_id: "b-1" }

  async function createTemplate() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(fullTemplate)),
    )
    const t = await Template.create({
      ...commonOpts,
      name: "my-env",
      from: "python:3.11",
    })
    vi.unstubAllGlobals()
    return t
  }

  it("getInfo refreshes from GET /templates/{id}", async () => {
    const t = await createTemplate()
    const updated = { ...baseTemplate, status: "ready" }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(updated)),
    )

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(409, "conflict")),
    )
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(build)),
    )

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "not_found")),
    )
    await expect(t.cancelBuild("b-1")).resolves.toBeUndefined()
  })
})
