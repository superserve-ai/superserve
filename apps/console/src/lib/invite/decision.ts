import type { InviteAcceptError, InvitePreview } from "./internal-api"

// Whether the signed-in account already belongs to at least one completed
// team. "unknown" covers a degraded or failed lookup: the page then asks for
// an explicit confirmation instead of joining silently.
export type InviteTeamState = "none" | "has_teams" | "unknown"

// Definitive refusals handed back from a join attempt so the page can explain
// them without retrying (and without looping back into an automatic join).
export type InviteFailure = "unavailable" | "already_member" | "email_mismatch"

const FAILURES: ReadonlySet<string> = new Set([
  "unavailable",
  "already_member",
  "email_mismatch",
])

export function parseInviteFailure(raw: unknown): InviteFailure | null {
  return typeof raw === "string" && FAILURES.has(raw)
    ? (raw as InviteFailure)
    : null
}

export type InviteViewer = {
  email: string
  emailVerified: boolean
} | null

export type InviteView =
  | { kind: "unavailable"; signedIn: boolean }
  | { kind: "signed_out"; preview: InvitePreview }
  | { kind: "mismatch"; preview: InvitePreview; signedInEmail: string }
  | { kind: "already_member"; preview: InvitePreview }
  | { kind: "auto_accept"; preview: InvitePreview }
  | { kind: "confirm"; preview: InvitePreview; signedInEmail: string }

// Lowercase and trim only. Gmail dots and plus-addressing are deliberately
// not folded: the invited identity is the exact address that was typed.
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function decideInviteView(input: {
  preview: InvitePreview | null
  viewer: InviteViewer
  teamState: InviteTeamState
  failure?: InviteFailure | null
}): InviteView {
  const { preview, viewer, teamState, failure } = input
  if (!preview || !preview.available) {
    return { kind: "unavailable", signedIn: viewer !== null }
  }
  if (!viewer) return { kind: "signed_out", preview }
  if (!viewer.emailVerified) return { kind: "unavailable", signedIn: true }
  if (
    normalizeInviteEmail(viewer.email) !== normalizeInviteEmail(preview.email)
  ) {
    return { kind: "mismatch", preview, signedInEmail: viewer.email }
  }
  if (failure === "email_mismatch") {
    return { kind: "mismatch", preview, signedInEmail: viewer.email }
  }
  if (failure === "already_member") return { kind: "already_member", preview }
  if (failure === "unavailable") {
    return { kind: "unavailable", signedIn: true }
  }
  // A brand-new account arriving through the link joins directly; anyone who
  // already has a team (or whose team list could not be read) confirms first.
  if (teamState === "none") return { kind: "auto_accept", preview }
  return { kind: "confirm", preview, signedInEmail: viewer.email }
}

export function failureForAcceptError(error: InviteAcceptError): InviteFailure {
  if (error === "already_member" || error === "email_mismatch") return error
  return "unavailable"
}
