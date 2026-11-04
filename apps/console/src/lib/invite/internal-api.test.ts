import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/cells", () => ({
  cellFor: (region: string) => ({ apiBaseUrl: `https://api.${region}.test` }),
  internalApiTokenFor: () => "internal-token",
}))

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

import { acceptInvitation, previewInvitation } from "./internal-api"

const token = `ssinv_use_${"T".repeat(43)}`
const user = { id: "user-1", email: "a@example.com" }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const previewBody = {
  invitation_id: "inv-1",
  team_id: "team-1",
  team_name: "Acme",
  home_region: "use",
  email: "a@example.com",
  expires_at: "2026-11-11T00:00:00Z",
  status: "pending",
  available: true,
}

beforeEach(() => {
  fetchSpy.mockReset()
})

describe("previewInvitation", () => {
  it("posts the token to the region's internal route", async () => {
    fetchSpy.mockResolvedValue(json(previewBody))

    const result = await previewInvitation(token)

    expect(result).toMatchObject({
      ok: true,
      preview: { teamName: "Acme", region: "use", available: true },
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(
      "https://api.use.test/internal/team-invitations/preview",
    )
    expect(JSON.parse(init.body)).toEqual({ token })
  })

  it("keeps an unavailable invitation as a preview the caller can refuse", async () => {
    fetchSpy.mockResolvedValue(json({ ...previewBody, available: false }))

    expect(await previewInvitation(token)).toMatchObject({
      ok: true,
      preview: { available: false },
    })
  })

  it("treats any non-200 as unavailable", async () => {
    fetchSpy.mockResolvedValue(json({}, 404))
    expect(await previewInvitation(token)).toEqual({ ok: false })
  })
})

describe("acceptInvitation", () => {
  it("sends the verified identity and maps a join", async () => {
    fetchSpy.mockResolvedValue(
      json({
        team_id: "team-1",
        home_region: "use",
        team_name: "Acme",
        result: "joined",
      }),
    )

    expect(await acceptInvitation(token, user)).toEqual({
      ok: true,
      result: "joined",
      teamId: "team-1",
      teamName: "Acme",
      region: "use",
    })
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      token,
      user_id: "user-1",
      email: "a@example.com",
      email_verified: true,
    })
  })

  it("maps already_owner", async () => {
    fetchSpy.mockResolvedValue(
      json({ team_id: "t", team_name: "Acme", result: "already_owner" }),
    )
    expect(await acceptInvitation(token, user)).toMatchObject({
      ok: true,
      result: "already_owner",
    })
  })

  it.each([
    [403, "email_unverified", "email_unverified"],
    [403, "email_mismatch", "email_mismatch"],
    [409, "already_member", "already_member"],
    [404, "invitation_unavailable", "unavailable"],
    [410, "invitation_unavailable", "unavailable"],
    [400, "bad_request", "unavailable"],
  ])("maps %s %s", async (status, code, error) => {
    fetchSpy.mockResolvedValue(json({ error: { code, message: "x" } }, status))
    expect(await acceptInvitation(token, user)).toEqual({ ok: false, error })
  })

  it.each([
    ["an unreachable backend", () => Promise.reject(new Error("timeout"))],
    ["429", () => Promise.resolve(new Response(null, { status: 429 }))],
    ["503", () => Promise.resolve(json({ error: { code: "x" } }, 503))],
    ["an unreadable 200", () => Promise.resolve(new Response("<html>"))],
  ])("asks for a retry after %s, then joins", async (_n, failure) => {
    fetchSpy.mockImplementationOnce(failure)
    expect(await acceptInvitation(token, user)).toEqual({
      ok: false,
      error: "retry",
    })

    fetchSpy.mockResolvedValueOnce(
      json({ team_id: "t", team_name: "Acme", result: "joined" }),
    )
    expect(await acceptInvitation(token, user)).toMatchObject({
      ok: true,
      result: "joined",
    })
  })

  it("treats 404 and 410 as unavailable even without a body", async () => {
    for (const status of [404, 410]) {
      fetchSpy.mockResolvedValue(new Response(null, { status }))
      expect(await acceptInvitation(token, user)).toEqual({
        ok: false,
        error: "unavailable",
      })
    }
  })

  it("never calls the backend for a malformed token", async () => {
    expect(await acceptInvitation("nope", user)).toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
