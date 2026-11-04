import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/admin/permissions", () => ({
  canViewOtherUsersAccount: vi.fn(),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getApiBaseUrlForUser: vi.fn(),
  getAuthApiKeyForUser: vi.fn(),
  getTeamIdForUser: vi.fn(),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { canViewOtherUsersAccount } from "@/lib/admin/permissions"
import {
  getApiBaseUrlForUser,
  getAuthApiKeyForUser,
  getTeamIdForUser,
} from "@/lib/api/proxy-auth"
import {
  SIGNUP_RESTRICTED_MESSAGE,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import { createServerClient } from "@/lib/supabase/server"

import { DELETE, GET, POST } from "./route"

type AnyParams = { params: Promise<{ path?: string[] }> }

const mockUser = {
  id: "u1",
  email: "user@test.com",
  app_metadata: { permissions: ["users:read"] },
}

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
    fetchSpy.mockReset()
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: mockUser } }) },
    } as never)
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(true)
    vi.mocked(getTeamIdForUser).mockResolvedValue("team-1")
    vi.mocked(getAuthApiKeyForUser).mockResolvedValue("ss_live_test_key")
    vi.mocked(getApiBaseUrlForUser).mockResolvedValue(
      "https://api.test.superserve.ai",
    )
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
  })

  it("lets a non-staff team member read the management model", async () => {
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(false)

    const res = await GET(req("GET"), params())

    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/teams/team-1/management",
    )
  })

  it("returns 401 when signed out", async () => {
    vi.mocked(createServerClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)

    const res = await GET(req("GET"), params())

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("proxies the invitation list read for non-staff members", async () => {
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(false)

    const res = await GET(req("GET", ["invitations"]), params(["invitations"]))

    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/teams/team-1/invitations",
    )
  })

  it.each([
    ["POST", ["invitations"]],
    ["POST", ["invitations", "inv-1", "resend"]],
    ["POST", ["invitations", "inv-1", "delivery"]],
    ["POST", ["leave"]],
  ])(
    "does not proxy %s /%s, so invite tokens never reach the browser",
    async (method, segments) => {
      for (const staff of [false, true]) {
        vi.mocked(canViewOtherUsersAccount).mockReturnValue(staff)
        const res = await POST(
          req(method, segments, { body: JSON.stringify({ email: "a@b.co" }) }),
          params(segments),
        )
        expect(res.status).toBe(404)
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("keeps direct member adds and role changes staff-only", async () => {
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(false)

    const add = await POST(
      req("POST", ["members"], { body: JSON.stringify({ user_id: "u2" }) }),
      params(["members"]),
    )
    const role = await DELETE(
      req("DELETE", ["roles", "a1"]),
      params(["roles", "a1"]),
    )

    expect(add.status).toBe(404)
    expect(role.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("lets a non-staff member remove someone else but not themself", async () => {
    vi.mocked(canViewOtherUsersAccount).mockReturnValue(false)
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const other = await DELETE(
      req("DELETE", ["members", "u2"]),
      params(["members", "u2"]),
    )
    const self = await DELETE(
      req("DELETE", ["members", "u1"]),
      params(["members", "u1"]),
    )

    expect(other.status).toBe(204)
    expect(self.status).toBe(404)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/teams/team-1/members/u2",
    )
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

  it.each(["team", "key", "base"])(
    "maps signup denial from the %s lookup to a generic 403",
    async (lookup) => {
      if (lookup === "team")
        vi.mocked(getTeamIdForUser).mockRejectedValueOnce(
          new SignupRestrictedError(),
        )
      if (lookup === "key")
        vi.mocked(getAuthApiKeyForUser).mockRejectedValueOnce(
          new SignupRestrictedError(),
        )
      if (lookup === "base")
        vi.mocked(getApiBaseUrlForUser).mockRejectedValueOnce(
          new SignupRestrictedError(),
        )

      const res = await GET(req("GET"), params())

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: {
          code: "signup_blocked",
          message: SIGNUP_RESTRICTED_MESSAGE,
        },
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it("encodes team ids and only forwards query strings for reads", async () => {
    vi.mocked(getTeamIdForUser).mockResolvedValue("team 1")

    await GET(
      new NextRequest(
        new URL("https://console.test/api/team-management?include=roles"),
        { method: "GET" },
      ),
      params(),
    )
    await POST(
      new NextRequest(
        new URL("https://console.test/api/team-management/members?ignored=1"),
        { method: "POST", body: JSON.stringify({ user_id: "u2" }) },
      ),
      params(["members"]),
    )

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.test.superserve.ai/teams/team%201/management?include=roles",
    )
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://api.test.superserve.ai/teams/team%201/members",
    )
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
})
