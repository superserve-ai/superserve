import { AsyncLocalStorage } from "node:async_hooks"

import type { User } from "@supabase/supabase-js"

// This module is substituted only in the isolated fixture build. No live Auth,
// promotion, telemetry or email client is imported here.
export const syntheticAuth = {
  userId: "00000000-0000-4000-8000-000000000640",
  email: "fixture@example.test",
}

type FixtureState = {
  caseId: string
  evidence?: { userId: string; attemptId: string }
  binds: number
  associations: number
}
const cases = new Map<string, FixtureState>()
const current = new AsyncLocalStorage<FixtureState>()

export function withSyntheticCase<T>(caseId: string, run: () => T): T {
  let state = cases.get(caseId)
  if (!state) {
    state = {
      caseId,
      binds: 0,
      associations: 0,
      ...(caseId === "ss640-google-existing-replay"
        ? {
            evidence: {
              userId: syntheticAuth.userId,
              attemptId: "original-attempt",
            },
          }
        : {}),
    }
    cases.set(caseId, state)
  }
  return current.run(state, run)
}

function state() {
  const value = current.getStore()
  if (!value) throw new Error("Synthetic callback has no case context")
  return value
}

export async function createServerClient() {
  const fixture = state()
  const email = fixture.caseId === "ss640-email-confirmed-entry"
  const user: User = {
    id: syntheticAuth.userId,
    aud: "authenticated",
    email: syntheticAuth.email,
    created_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: email ? "email" : "google" },
    user_metadata: { full_name: "Synthetic account" },
  }
  return {
    auth: {
      exchangeCodeForSession: async () => ({
        error:
          fixture.caseId === "ss640-google-auth-error"
            ? { message: "synthetic_auth_exchange_failed" }
            : null,
      }),
      verifyOtp: async () => ({ error: null }),
      getUser: async () => ({ data: { user }, error: null }),
    },
  }
}

export async function listTeamMembershipsForUserDetailed(userId: string) {
  if (userId !== syntheticAuth.userId)
    throw new Error("Synthetic actor mismatch")
  return {
    memberships:
      state().caseId === "ss640-google-existing-replay"
        ? [{ teamId: "existing-east-team", region: "use" }]
        : [],
    degradedRegions:
      state().caseId === "ss640-google-directory-error" ? ["use"] : [],
  }
}

export function isGoogleUser(user: User) {
  return user.app_metadata.provider === "google"
}
export async function hasValidGoogleSignupProof(attemptId: string) {
  return (
    state().caseId !== "ss640-google-recovery" &&
    attemptId === "synthetic-oauth-attempt"
  )
}
export async function hasValidLegacyGoogleSignupProof() {
  return false
}
export async function readGoogleSignupDeviceAttempt(attemptId: string) {
  return (await hasValidGoogleSignupProof(attemptId))
    ? "synthetic-attempt"
    : undefined
}
export async function markGoogleSignupAttempt() {
  state().associations += 1
}
export async function bindPromotionSignupAccount(
  userId: string,
  attemptId: string,
) {
  if (userId !== syntheticAuth.userId || attemptId !== "synthetic-attempt")
    throw new Error("Synthetic binding mismatch")
  const fixture = state()
  // Original evidence remains immutable, including existing-account callbacks.
  if (!fixture.evidence) {
    fixture.evidence = { userId, attemptId }
    fixture.binds += 1
  }
}
export function validSignupDeviceBinding(
  userId: string,
  attemptId: string,
  proof: string,
) {
  return (
    userId === syntheticAuth.userId &&
    attemptId === "synthetic-attempt" &&
    proof === "synthetic-proof"
  )
}
export async function consumeFingerprintSignupEventId() {
  return undefined
}
export function scheduleFingerprintObservation() {}
export async function sendWelcomeEmail() {}
export async function notifySlackOfNewUser() {}
export async function trackEvent() {}
