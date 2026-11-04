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
  clearFirstSignup: vi.fn(),
  completeFirstSignup: vi.fn(),
  isGoogleUser: vi.fn(),
  hasIntent: vi.fn(),
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
  clearFirstSignup: mocks.clearFirstSignup,
  completeFirstSignup: mocks.completeFirstSignup,
}))
vi.mock("@/lib/auth/google-signup-proof", () => ({
  GoogleSignupProofRequiredError: class extends Error {},
  GoogleSignupRecoveryRequiredError: class extends Error {},
  isGoogleUser: mocks.isGoogleUser,
}))
vi.mock("@/lib/auth/signup-restrictions", () => ({
  SignupRestrictedError: class extends Error {},
}))
vi.mock("./intent", () => ({ hasInviteIntent: mocks.hasIntent }))
vi.mock("@/lib/api/active-team", () => ({
  writeTeamSelection: mocks.writeSelection,
}))
vi.mock("./internal-api", () => ({
  previewInvitation: mocks.preview,
  acceptInvitation: mocks.accept,
}))

import {
  GoogleSignupProofRequiredError,
  GoogleSignupRecoveryRequiredError,
} from "@/lib/auth/google-signup-proof"
import { SignupRestrictedError } from "@/lib/auth/signup-restrictions"
import { SignupReviewPendingError } from "@/lib/auth/signup-review"

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

const clearance = { firstTeam: true, googleProvisioning: null, evidence: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: signedIn } })
  mocks.preview.mockResolvedValue({ ok: true, preview })
  mocks.listMemberships.mockResolvedValue({
    memberships: [],
    degradedRegions: [],
  })
  mocks.completed.mockResolvedValue({ memberships: [], degradedRegions: [] })
  mocks.hasIntent.mockResolvedValue(true)
  mocks.isGoogleUser.mockReturnValue(false)
  mocks.clearFirstSignup.mockResolvedValue(clearance)
})

describe("loadInviteView", () => {
  it("shows a signed-out visitor the sign-up choice without any team lookup", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const { view, user } = await loadInviteView(token)

    expect(view.kind).toBe("signed_out")
    expect(user).toBeNull()
    expect(mocks.listMemberships).not.toHaveBeenCalled()
  })

  it("auto-accepts only a teamless account that started from this invite", async () => {
    expect((await loadInviteView(token)).view.kind).toBe("auto_accept")
    expect(mocks.hasIntent).toHaveBeenCalledWith(token)
  })

  it("confirms a teamless account that did not start from this invite", async () => {
    mocks.hasIntent.mockResolvedValue(false)

    const { view } = await loadInviteView(token)

    expect(view).toMatchObject({ kind: "confirm", teamless: true })
  })

  it("reads the team list fresh across regions", async () => {
    await loadInviteView(token)

    expect(mocks.listMemberships).toHaveBeenCalledWith("user-1", {
      strict: true,
    })
  })

  it("asks an account that already has a team to confirm", async () => {
    mocks.completed.mockResolvedValue({
      memberships: [{ teamId: "t0", region: "use" }],
      degradedRegions: [],
    })

    expect(await loadInviteView(token)).toMatchObject({
      view: { kind: "confirm", teamless: false },
    })
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
  const user = {
    id: "user-1",
    email: "invitee@example.com",
    app_metadata: {},
  } as never
  const joined = {
    ok: true,
    result: "joined",
    teamId: "team-1",
    teamName: "Acme",
    region: "usw",
  }

  it("selects the joined team and drops the cached directory", async () => {
    mocks.accept.mockResolvedValue(joined)

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
    expect(mocks.completeFirstSignup).not.toHaveBeenCalled()
  })

  describe("first-signup gates", () => {
    it("checks them in the invite's region before the backend is called", async () => {
      mocks.isGoogleUser.mockReturnValue(true)
      mocks.accept.mockResolvedValue(joined)

      await acceptInviteAndSelectTeam(token, user)

      expect(mocks.clearFirstSignup).toHaveBeenCalledWith("use", user, {
        googleProof: true,
      })
      expect(mocks.clearFirstSignup.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.accept.mock.invocationCallOrder[0],
      )
    })

    it.each([
      [
        "a Google account without signup proof",
        () => new GoogleSignupProofRequiredError(),
      ],
      [
        "a Google account needing recovery",
        () => new GoogleSignupRecoveryRequiredError(),
      ],
      ["a device-restricted signup", () => new SignupRestrictedError()],
      ["an Enterprise review hold", () => new SignupReviewPendingError()],
    ])("refuses %s without joining", async (_label, makeError) => {
      mocks.clearFirstSignup.mockRejectedValue(makeError())

      const result = await acceptInviteAndSelectTeam(token, user)

      expect(result).toEqual({ ok: false, error: "not_eligible" })
      expect(mocks.accept).not.toHaveBeenCalled()
      expect(mocks.writeSelection).not.toHaveBeenCalled()
      expect(mocks.completeFirstSignup).not.toHaveBeenCalled()
    })

    it("refuses a held account before looking at anything else", async () => {
      const held = {
        ...(user as object),
        app_metadata: { signup_review: "pending" },
      }

      const result = await acceptInviteAndSelectTeam(token, held as never)

      expect(result).toEqual({ ok: false, error: "not_eligible" })
      expect(mocks.clearFirstSignup).not.toHaveBeenCalled()
      expect(mocks.accept).not.toHaveBeenCalled()
    })

    it("lets a retryable lookup failure surface instead of refusing", async () => {
      mocks.clearFirstSignup.mockRejectedValue(new Error("lookup degraded"))

      await expect(acceptInviteAndSelectTeam(token, user)).rejects.toThrow(
        "lookup degraded",
      )
      expect(mocks.accept).not.toHaveBeenCalled()
    })

    it("lets an account with a completed team through", async () => {
      mocks.clearFirstSignup.mockResolvedValue({
        ...clearance,
        firstTeam: false,
      })
      mocks.accept.mockResolvedValue(joined)

      expect((await acceptInviteAndSelectTeam(token, user)).ok).toBe(true)
    })

    it("spends the signup proof only after the join succeeded", async () => {
      const googleClearance = {
        firstTeam: true,
        googleProvisioning: { signupAttemptId: "attempt-1" },
        evidence: [],
      }
      mocks.clearFirstSignup.mockResolvedValue(googleClearance)
      mocks.accept.mockResolvedValue(joined)

      await acceptInviteAndSelectTeam(token, user)

      expect(mocks.completeFirstSignup).toHaveBeenCalledWith(
        "user-1",
        googleClearance,
      )
      expect(mocks.accept.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.completeFirstSignup.mock.invocationCallOrder[0],
      )
    })

    it("still reports success when the proof cannot be spent", async () => {
      mocks.accept.mockResolvedValue(joined)
      mocks.completeFirstSignup.mockRejectedValue(new Error("cookie store"))
      vi.spyOn(console, "warn").mockImplementation(() => {})

      expect((await acceptInviteAndSelectTeam(token, user)).ok).toBe(true)
    })

    it("never provisions a team", async () => {
      mocks.accept.mockResolvedValue(joined)

      await acceptInviteAndSelectTeam(token, user)

      expect(mocks.provisionTeam).not.toHaveBeenCalled()
    })
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
    path.join(here, "../../app/(public)/invite/[token]/invite-controls.tsx"),
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
