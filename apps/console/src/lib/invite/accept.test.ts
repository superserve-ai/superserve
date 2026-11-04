import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  listMemberships: vi.fn(),
  invalidate: vi.fn(),
  completed: vi.fn(),
  preview: vi.fn(),
  accept: vi.fn(),
  writeSelection: vi.fn(),
  provisionTeam: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock("@/lib/api/team-directory", () => ({
  listTeamMembershipsForUserDetailed: mocks.listMemberships,
  invalidateMembershipDirectory: mocks.invalidate,
}))
vi.mock("@/lib/api/team-provisioning", () => ({
  completedMemberships: mocks.completed,
  provisionTeam: mocks.provisionTeam,
}))
vi.mock("@/lib/api/active-team", () => ({
  writeTeamSelection: mocks.writeSelection,
}))
vi.mock("./internal-api", () => ({
  previewInvitation: mocks.preview,
  acceptInvitation: mocks.accept,
}))

import { acceptInviteAndSelectTeam, loadInviteView } from "./accept"

const token = `ssinv_use_${"A".repeat(43)}`
const preview = {
  invitationId: "inv-1",
  teamId: "team-1",
  teamName: "Acme",
  region: "use",
  email: "invitee@example.com",
  expiresAt: "2026-12-01T00:00:00Z",
  status: "pending",
  available: true,
}
const signedIn = {
  id: "user-1",
  email: "invitee@example.com",
  email_confirmed_at: "2026-11-01T00:00:00Z",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: signedIn } })
  mocks.preview.mockResolvedValue({ ok: true, preview })
  mocks.listMemberships.mockResolvedValue({
    memberships: [],
    degradedRegions: [],
  })
  mocks.completed.mockResolvedValue({ memberships: [], degradedRegions: [] })
})

describe("loadInviteView", () => {
  it("shows a signed-out visitor the sign-up choice without any team lookup", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const { view, user } = await loadInviteView(token)

    expect(view.kind).toBe("signed_out")
    expect(user).toBeNull()
    expect(mocks.listMemberships).not.toHaveBeenCalled()
  })

  it("auto-accepts only an account with no team", async () => {
    expect((await loadInviteView(token)).view.kind).toBe("auto_accept")
  })

  it("asks an account that already has a team to confirm", async () => {
    mocks.completed.mockResolvedValue({
      memberships: [{ teamId: "t0", region: "use" }],
      degradedRegions: [],
    })

    expect((await loadInviteView(token)).view.kind).toBe("confirm")
  })

  it.each([
    ["a degraded cell", { memberships: [], degradedRegions: ["usw"] }],
    ["a failed lookup", null],
  ])("confirms instead of joining silently after %s", async (_label, value) => {
    if (value) mocks.listMemberships.mockResolvedValue(value)
    else mocks.listMemberships.mockRejectedValue(new Error("down"))

    expect((await loadInviteView(token)).view.kind).toBe("confirm")
  })

  it("shows the mismatch screen for a different email", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...signedIn, email: "other@example.com" } },
    })

    expect((await loadInviteView(token)).view.kind).toBe("mismatch")
  })

  it("is unavailable when the invitation cannot be previewed", async () => {
    mocks.preview.mockResolvedValue({ ok: false })

    expect((await loadInviteView(token)).view).toEqual({
      kind: "unavailable",
      signedIn: true,
    })
  })

  it("never provisions a team while deciding", async () => {
    await loadInviteView(token)

    expect(mocks.provisionTeam).not.toHaveBeenCalled()
    expect(mocks.writeSelection).not.toHaveBeenCalled()
  })
})

describe("acceptInviteAndSelectTeam", () => {
  const user = { id: "user-1", email: "invitee@example.com" }

  it("selects the joined team and drops the cached directory", async () => {
    mocks.accept.mockResolvedValue({
      ok: true,
      result: "joined",
      teamId: "team-1",
      teamName: "Acme",
      region: "usw",
    })

    const result = await acceptInviteAndSelectTeam(token, user)

    expect(result.ok).toBe(true)
    expect(mocks.invalidate).toHaveBeenCalledWith("user-1")
    expect(mocks.writeSelection).toHaveBeenCalledWith({
      region: "usw",
      teamId: "team-1",
    })
  })

  it("leaves the selection alone when the backend refuses", async () => {
    mocks.accept.mockResolvedValue({ ok: false, error: "email_mismatch" })

    const result = await acceptInviteAndSelectTeam(token, user)

    expect(result).toEqual({ ok: false, error: "email_mismatch" })
    expect(mocks.writeSelection).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
})

describe("invite path isolation", () => {
  // The first-login personal team is created by proxy-auth / api-key-mint.
  // An invited account must join the inviting team first, so nothing the
  // invite flow imports may reach them.
  const forbiddenModules = ["proxy-auth", "api-key-mint"]
  const forbiddenCalls = [
    "provisionTeam",
    "provisionHeldApplicantTeam",
    "getTeamForUser",
    "getAuthApiKey",
  ]
  const here = path.dirname(new URL(import.meta.url).pathname)
  const files = [
    ...readdirSync(here)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => path.join(here, name)),
    path.join(here, "../../app/(public)/invite/[token]/actions.ts"),
    path.join(here, "../../app/(public)/invite/[token]/join/route.ts"),
    path.join(here, "../../app/(public)/invite/[token]/page.tsx"),
  ]

  it.each(files.map((file) => [path.relative(here, file), file]))(
    "%s does not import provisioning",
    (_name, file) => {
      const source = readFileSync(file, "utf8")
      const imports = source
        .split("\n")
        .filter((line) => /^\s*(import|\} from)/.test(line))
        .join("\n")
      for (const needle of forbiddenModules) {
        expect(imports).not.toContain(needle)
      }
      for (const needle of forbiddenCalls) {
        expect(source).not.toContain(needle)
      }
    },
  )
})
