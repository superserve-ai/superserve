import { describe, expect, it } from "vitest"

import {
  decideInviteView,
  failureForAcceptError,
  normalizeInviteEmail,
  parseInviteFailure,
} from "./decision"
import type { InvitePreview } from "./internal-api"

const preview: InvitePreview = {
  invitationId: "inv-1",
  teamId: "team-1",
  teamName: "Acme",
  region: "use",
  email: "Invitee@Example.com",
  expiresAt: "2026-12-01T00:00:00Z",
  status: "pending",
  available: true,
}

const matching = { email: "invitee@example.com", emailVerified: true }

describe("decideInviteView", () => {
  it.each([
    ["missing preview", null],
    ["closed invitation", { ...preview, available: false, status: "revoked" }],
  ])("is unavailable for a %s", (_label, input) => {
    expect(
      decideInviteView({ preview: input, viewer: null, teamState: "none" }),
    ).toEqual({ kind: "unavailable", signedIn: false })
    expect(
      decideInviteView({
        preview: input,
        viewer: matching,
        teamState: "has_teams",
      }),
    ).toEqual({ kind: "unavailable", signedIn: true })
  })

  it("asks a signed-out visitor to create an account or sign in", () => {
    expect(
      decideInviteView({ preview, viewer: null, teamState: "unknown" }),
    ).toEqual({ kind: "signed_out", preview })
  })

  it("does not treat an unverified email as a match", () => {
    expect(
      decideInviteView({
        preview,
        viewer: { ...matching, emailVerified: false },
        teamState: "none",
      }),
    ).toEqual({ kind: "unavailable", signedIn: true })
  })

  it("shows the mismatch screen before anything is provisioned", () => {
    expect(
      decideInviteView({
        preview,
        viewer: { email: "someone@else.com", emailVerified: true },
        teamState: "none",
      }),
    ).toEqual({
      kind: "mismatch",
      preview,
      signedInEmail: "someone@else.com",
    })
  })

  it("matches case-insensitively and trims, and nothing more", () => {
    expect(
      decideInviteView({
        preview,
        viewer: { email: "  INVITEE@example.COM ", emailVerified: true },
        teamState: "none",
        intent: true,
      }).kind,
    ).toBe("auto_accept")
    expect(
      decideInviteView({
        preview,
        viewer: { email: "invitee+tag@example.com", emailVerified: true },
        teamState: "none",
      }).kind,
    ).toBe("mismatch")
    expect(
      decideInviteView({
        preview: { ...preview, email: "first.last@gmail.com" },
        viewer: { email: "firstlast@gmail.com", emailVerified: true },
        teamState: "none",
      }).kind,
    ).toBe("mismatch")
  })

  it("joins a brand-new account directly only with signup intent", () => {
    expect(
      decideInviteView({
        preview,
        viewer: matching,
        teamState: "none",
        intent: true,
      }),
    ).toEqual({ kind: "auto_accept", preview })
  })

  it("confirms a teamless account that did not start from the invite", () => {
    expect(
      decideInviteView({ preview, viewer: matching, teamState: "none" }),
    ).toEqual({
      kind: "confirm",
      preview,
      signedInEmail: "invitee@example.com",
      teamless: true,
    })
  })

  it.each(["has_teams", "unknown"] as const)(
    "never auto-joins when the team state is %s, even with intent",
    (teamState) => {
      expect(
        decideInviteView({
          preview,
          viewer: matching,
          teamState,
          intent: true,
        }).kind,
      ).toBe("confirm")
    },
  )

  it.each(["has_teams", "unknown"] as const)(
    "confirms first when the team state is %s",
    (teamState) => {
      expect(
        decideInviteView({ preview, viewer: matching, teamState }),
      ).toEqual({
        kind: "confirm",
        preview,
        signedInEmail: "invitee@example.com",
        teamless: false,
      })
    },
  )

  it("never auto-joins again after a refusal", () => {
    expect(
      decideInviteView({
        preview,
        viewer: matching,
        teamState: "none",
        intent: true,
        failure: "unavailable",
      }),
    ).toEqual({ kind: "unavailable", signedIn: true })
    expect(
      decideInviteView({
        preview,
        viewer: matching,
        teamState: "none",
        intent: true,
        failure: "already_member",
      }),
    ).toEqual({ kind: "already_member", preview })
    expect(
      decideInviteView({
        preview,
        viewer: matching,
        teamState: "none",
        intent: true,
        failure: "not_eligible",
      }),
    ).toEqual({ kind: "not_eligible", preview })
    expect(
      decideInviteView({
        preview,
        viewer: matching,
        teamState: "none",
        failure: "email_mismatch",
      }).kind,
    ).toBe("mismatch")
  })

  it("does not let a failure parameter expose a closed invitation", () => {
    expect(
      decideInviteView({
        preview: { ...preview, available: false },
        viewer: matching,
        teamState: "none",
        failure: "already_member",
      }),
    ).toEqual({ kind: "unavailable", signedIn: true })
  })
})

describe("normalizeInviteEmail", () => {
  it("lowercases and trims only", () => {
    expect(normalizeInviteEmail("  A.B+c@Example.COM ")).toBe(
      "a.b+c@example.com",
    )
  })
})

describe("parseInviteFailure", () => {
  it("accepts only the known codes", () => {
    expect(parseInviteFailure("already_member")).toBe("already_member")
    expect(parseInviteFailure("email_unverified")).toBeNull()
    expect(parseInviteFailure("<script>")).toBeNull()
    expect(parseInviteFailure(undefined)).toBeNull()
  })
})

describe("failureForAcceptError", () => {
  it("maps refusals to a page failure, defaulting to unavailable", () => {
    expect(failureForAcceptError("already_member")).toBe("already_member")
    expect(failureForAcceptError("email_mismatch")).toBe("email_mismatch")
    expect(failureForAcceptError("not_eligible")).toBe("not_eligible")
    expect(failureForAcceptError("email_unverified")).toBe("unavailable")
    expect(failureForAcceptError("unavailable")).toBe("unavailable")
  })
})
