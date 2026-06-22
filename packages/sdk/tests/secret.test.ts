import { afterEach, describe, expect, it, vi } from "vitest"

import { Secret } from "../src/Secret.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(status: number, code = "error"): Response {
  return new Response(JSON.stringify({ error: { code, message: "boom" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const baseSecret = {
  id: "sec-1",
  name: "anthropic-prod",
  auth_type: "api-key",
  auth_config: { header: "x-api-key" },
  provider_shortcut: "anthropic",
  hosts: ["api.anthropic.com"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_used_at: "2026-01-03T00:00:00Z",
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

describe("Secret.create", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("POSTs /secrets with a provider shortcut", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", mock)

    const secret = await Secret.create({
      ...commonOpts,
      name: "anthropic-prod",
      value: "sk-ant-real",
      provider: "anthropic",
    })

    expect(secret.name).toBe("anthropic-prod")
    expect(secret.authType).toBe("api-key")
    expect(secret.providerShortcut).toBe("anthropic")
    expect(secret.hosts).toEqual(["api.anthropic.com"])
    expect(secret.createdAt).toBeInstanceOf(Date)
    expect(secret.lastUsedAt?.toISOString()).toBe("2026-01-03T00:00:00.000Z")

    const [url, init] = mock.mock.calls[0]
    expect(url).toBe("https://api.superserve.ai/secrets")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      name: "anthropic-prod",
      value: "sk-ant-real",
      provider: "anthropic",
    })
  })

  it("converts a perHost auth config to snake_case", async () => {
    const mock = vi.fn(async () =>
      jsonResponse({ ...baseSecret, auth_type: "per_host" }),
    )
    vi.stubGlobal("fetch", mock)

    await Secret.create({
      ...commonOpts,
      name: "gh",
      value: "ghp_real",
      hosts: ["api.github.com", "github.com"],
      auth: {
        perHost: [
          { hosts: ["api.github.com"], type: "bearer" },
          { hosts: ["github.com"], type: "basic", username: "x-access-token" },
        ],
      },
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.auth).toEqual({
      per_host: [
        { hosts: ["api.github.com"], type: "bearer" },
        { hosts: ["github.com"], type: "basic", username: "x-access-token" },
      ],
    })
    expect(body.hosts).toEqual(["api.github.com", "github.com"])
  })

  it("sends a single-rule custom auth config as-is", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", mock)

    await Secret.create({
      ...commonOpts,
      name: "x",
      value: "v",
      hosts: ["api.example.com"],
      auth: { type: "api-key", header: "X-Api-Key" },
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.auth).toEqual({ type: "api-key", header: "X-Api-Key" })
  })
})

describe("Secret static reads", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("get() fetches by name", async () => {
    const mock = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", mock)

    const secret = await Secret.get("anthropic-prod", commonOpts)
    expect(secret.id).toBe("sec-1")
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.superserve.ai/secrets/anthropic-prod",
    )
  })

  it("list() returns SecretInfo[]", async () => {
    const mock = vi.fn(async () =>
      jsonResponse([
        baseSecret,
        { ...baseSecret, id: "sec-2", name: "openai" },
      ]),
    )
    vi.stubGlobal("fetch", mock)

    const secrets = await Secret.list(commonOpts)
    expect(secrets.map((s) => s.name)).toEqual(["anthropic-prod", "openai"])
  })

  it("deleteByName() swallows 404", async () => {
    const mock = vi.fn(async () => errorResponse(404, "not_found"))
    vi.stubGlobal("fetch", mock)
    await expect(
      Secret.deleteByName("gone", commonOpts),
    ).resolves.toBeUndefined()
  })
})

describe("Secret instance methods", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("rotate() PATCHes the value and returns the updated secret", async () => {
    const created = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", created)
    const secret = await Secret.create({
      ...commonOpts,
      name: "anthropic-prod",
      value: "v",
      provider: "anthropic",
    })
    vi.unstubAllGlobals()

    const rotated = vi.fn(async () =>
      jsonResponse({ ...baseSecret, updated_at: "2026-02-01T00:00:00Z" }),
    )
    vi.stubGlobal("fetch", rotated)

    const updated = await secret.rotate("sk-ant-new")
    const [url, init] = rotated.mock.calls[0]
    expect(url).toBe("https://api.superserve.ai/secrets/anthropic-prod")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ value: "sk-ant-new" })
    expect(updated.updatedAt.toISOString()).toBe("2026-02-01T00:00:00.000Z")
  })

  it("getAudit() builds the query string and maps events", async () => {
    const created = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", created)
    const secret = await Secret.create({
      ...commonOpts,
      name: "anthropic-prod",
      value: "v",
      provider: "anthropic",
    })
    vi.unstubAllGlobals()

    const audit = vi.fn(async () =>
      jsonResponse([
        {
          id: 5,
          ts: "2026-01-04T00:00:00Z",
          sandbox_id: "sb-1",
          method: "POST",
          host: "api.anthropic.com",
          path: "/v1/messages",
          status: 200,
        },
      ]),
    )
    vi.stubGlobal("fetch", audit)

    const events = await secret.getAudit({
      limit: 10,
      before: 99,
      status: "4xx",
    })
    const url = audit.mock.calls[0][0] as string
    expect(url).toContain("/secrets/anthropic-prod/audit?")
    expect(url).toContain("limit=10")
    expect(url).toContain("before=99")
    expect(url).toContain("status=4xx")
    expect(events[0].method).toBe("POST")
    expect(events[0].ts).toBeInstanceOf(Date)
  })

  it("getSandboxes() maps bindings", async () => {
    const created = vi.fn(async () => jsonResponse(baseSecret))
    vi.stubGlobal("fetch", created)
    const secret = await Secret.create({
      ...commonOpts,
      name: "anthropic-prod",
      value: "v",
      provider: "anthropic",
    })
    vi.unstubAllGlobals()

    const bound = vi.fn(async () =>
      jsonResponse([
        {
          sandbox_id: "sb-1",
          sandbox_name: "agent-1",
          env_key: "ANTHROPIC_API_KEY",
          status: "active",
        },
      ]),
    )
    vi.stubGlobal("fetch", bound)

    const sandboxes = await secret.getSandboxes()
    expect(sandboxes[0].envKey).toBe("ANTHROPIC_API_KEY")
    expect(sandboxes[0].status).toBe("active")
  })
})
