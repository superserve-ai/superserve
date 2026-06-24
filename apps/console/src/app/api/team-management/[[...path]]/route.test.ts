import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationTeamId: vi.fn(),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyForUser: vi.fn(),
  getTeamIdForUser: vi.fn(),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { getAuthApiKeyForUser, getTeamIdForUser } from "@/lib/api/proxy-auth"
import { createServerClient } from "@/lib/supabase/server"

import { DELETE, GET, POST } from "./route"

type AnyParams = { params: Promise<{ path?: string[] }> }

const mockUser = { id: "u1", email: "user@test.com", app_metadata: {} }

function req(
  method: string,
  pathSegments: string[] = [],
  init: { headers?: Record<string, string>; body?: BodyInit } = {},
): NextRequest {
  const suffix = pathSegments.length > 0 ? `/${pathSegments.join("/")}` : ""
  const url = new URL(`https://console.test/api/team-management${suffix}`)
  return new NextRequest(url, {
    method,
    headers: init.headers,
    body: init.body,
  })
}

function params(pathSegments: string[] = []): AnyParams {
  return { params: Promise.resolve({ path: pathSegments }) }
}

describe("api proxy /api/team-management", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_TEAM_MANAGEMENT = "true"
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: mockUser } }) },
    } as never)
    vi.mocked(getImpersonationTeamId).mockResolvedValue(null)
    vi.mocked(getTeamIdForUser).mockResolvedValue("team-1")
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })

  it("returns 404 when the feature flag is disabled", async () => {
    process.env.NEXT_PUBLIC_ENABLE_TEAM_MANAGEMENT = "false"

    const res = await GET(req("GET"), params())

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies the current team's management read model", async () => {
    const res = await GET(req("GET"), params())

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, fetchInit] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://api.test.superserve.ai/teams/team-1/management")
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
  })

  it("strips client-supplied actor and API key headers", async () => {
    await POST(
      req("POST", ["members"], {
        headers: {
          "content-type": "application/json",
          "x-actor-user-id": "platform-actor",
          "x-api-key": "attacker-key",
        },
        body: JSON.stringify({ user_id: "user-2", status: "invited" }),
      }),
      params(["members"]),
    )

    const [, fetchInit] = fetchSpy.mock.calls[0]
    const headers = fetchInit.headers as Headers
    expect(headers.get("x-actor-user-id")).toBeNull()
    expect(headers.get("x-api-key")).toBe("ss_live_test_key")
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("proxies role revocation to the current team route", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const res = await DELETE(
      req("DELETE", ["roles", "assignment-1"]),
      params(["roles", "assignment-1"]),
    )

    expect(res.status).toBe(204)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      "https://api.test.superserve.ai/teams/team-1/roles/assignment-1",
    )
  })

  it("blocks writes while impersonating", async () => {
    vi.mocked(getImpersonationTeamId).mockResolvedValue("team-impersonated")

    const res = await POST(req("POST", ["roles"]), params(["roles"]))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
