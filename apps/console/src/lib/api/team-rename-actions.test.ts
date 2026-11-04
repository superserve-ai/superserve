import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}))
vi.mock("@/lib/api/proxy-auth", () => ({
  getAuthApiKeyAndTeamForUser: vi.fn(),
}))
vi.mock("@/lib/api/team-directory", () => ({
  invalidateMembershipDirectory: vi.fn(),
}))
vi.mock("@/lib/cells", () => ({
  cellFor: () => ({ apiBaseUrl: "https://api.test.superserve.ai" }),
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { getAuthApiKeyAndTeamForUser } from "@/lib/api/proxy-auth"
import { invalidateMembershipDirectory } from "@/lib/api/team-directory"

import {
  getTeamRenameAccessAction,
  renameTeamAction,
} from "./team-rename-actions"

const expected = { teamId: "team-1", region: "use" }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  vi.mocked(invalidateMembershipDirectory).mockReset()
  vi.mocked(getAuthApiKeyAndTeamForUser).mockResolvedValue({
    apiKey: "ss_live_test_key",
    team: { teamId: "team-1", region: "use" },
  })
})

describe("renameTeamAction", () => {
  it("patches the active team with the user's key and invalidates the directory", async () => {
    fetchSpy.mockResolvedValue(
      json(200, { id: "team-1", name: "Acme", home_region: "use" }),
    )

    const result = await renameTeamAction(expected, "  Acme  ")

    expect(result).toEqual({
      ok: true,
      team: { id: "team-1", name: "Acme", region: "use" },
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe("https://api.test.superserve.ai/teams/team-1")
    expect(init.method).toBe("PATCH")
    expect(init.headers["X-API-Key"]).toBe("ss_live_test_key")
    expect(JSON.parse(init.body)).toEqual({ name: "Acme" })
    expect(invalidateMembershipDirectory).toHaveBeenCalledWith("u1")
  })

  it("maps a name conflict to the neutral message and keeps caches", async () => {
    fetchSpy.mockResolvedValue(
      json(409, {
        error: { code: "team_name_unavailable", message: "internal detail" },
      }),
    )

    const result = await renameTeamAction(expected, "Taken")

    expect(result).toEqual({
      ok: false,
      code: "name_unavailable",
      message: "That name is unavailable. Try another.",
    })
    expect(invalidateMembershipDirectory).not.toHaveBeenCalled()
  })

  it("reports a forbidden rename without invalidating", async () => {
    fetchSpy.mockResolvedValue(
      json(403, { error: { code: "forbidden", message: "nope" } }),
    )

    const result = await renameTeamAction(expected, "Acme")

    expect(result).toMatchObject({ ok: false, code: "forbidden" })
    expect(invalidateMembershipDirectory).not.toHaveBeenCalled()
  })

  it("refuses to call the backend when the active team changed", async () => {
    vi.mocked(getAuthApiKeyAndTeamForUser).mockResolvedValue({
      apiKey: "ss_live_test_key",
      team: { teamId: "team-2", region: "use" },
    })

    const result = await renameTeamAction(expected, "Acme")

    expect(result).toMatchObject({ ok: false, code: "team_changed" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each(["   ", "a".repeat(65), "bad\u0000name"])(
    "rejects an invalid name locally: %j",
    async (name) => {
      const result = await renameTeamAction(expected, name)

      expect(result).toMatchObject({ ok: false, code: "invalid_name" })
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )
})

describe("getTeamRenameAccessAction", () => {
  it("reads can_rename_team from the management capabilities", async () => {
    fetchSpy.mockResolvedValue(
      json(200, { capabilities: { can_rename_team: true } }),
    )
    expect(await getTeamRenameAccessAction()).toBe(true)
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://api.test.superserve.ai/teams/team-1/management",
    )
  })

  it("falls back to read-only when the capability is absent or the read fails", async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { capabilities: {} }))
    expect(await getTeamRenameAccessAction()).toBe(false)
    fetchSpy.mockResolvedValueOnce(json(403, { error: { code: "forbidden" } }))
    expect(await getTeamRenameAccessAction()).toBe(false)
    fetchSpy.mockRejectedValueOnce(new Error("network"))
    expect(await getTeamRenameAccessAction()).toBe(false)
  })
})
