import type { Session, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  consumeFingerprintSignupEventId,
  readFingerprintSignupEventId,
  sendWelcomeEmail,
} from "@/app/(auth)/auth/signup/action"
import { publishOriginalSignupEvidence } from "@/lib/api/promotion-publication"
import { listTeamMembershipsForUserDetailed } from "@/lib/api/team-directory"
import { completedMemberships } from "@/lib/api/team-provisioning"
import { isGenericAuthSignupFailure } from "@/lib/auth/errors"
import {
  classifyGoogleMembershipState,
  type GoogleMembershipState,
} from "@/lib/auth/google-onboarding"
import {
  hasValidGoogleSignupProof,
  hasValidLegacyGoogleSignupProof,
  isGoogleUser,
  markGoogleSignupAttempt,
  readGooglePromotionEvidence,
  retainOriginalGoogleSignup,
} from "@/lib/auth/google-signup-proof"
import { PLAN_OFFER_COOKIE } from "@/lib/auth/plan-preselection"
import { normalizeRequestedOffer } from "@/lib/auth/requested-offer"
import {
  isActiveSignupEvidenceAttempt,
  readSignupEvidence,
  readSignupEvidenceEntries,
  saveSignupEvidence,
} from "@/lib/auth/signup-evidence"
import {
  evaluateSignupRestriction,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import {
  isSignupReviewBlocked,
  readSignupRequest,
  signupDetailsOffer,
  signupReviewMarker,
  storedSignupRequest,
} from "@/lib/auth/signup-review"
import {
  encodePendingProfile,
  PENDING_PROFILE_COOKIE,
  pendingProfileCookieOptions,
  readStashedSignupDetails,
  requiresSignupReview,
  SIGNUP_DETAILS_COOKIE,
  updateSignupReviewMetadata,
} from "@/lib/auth/signup-review-server"
import { DEFAULT_REGION } from "@/lib/cells"
import { validSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"
import { fingerprintDiagnostics } from "@/lib/fingerprint/diagnostics-server"
import { resolveFingerprintSignup } from "@/lib/fingerprint/observe"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { normalizeSignupEligibilitySnapshot } from "@/lib/slack/signup-eligibility"
import { notifySlackOfNewUser } from "@/lib/slack/signup-notification"
import { createServerClient } from "@/lib/supabase/server"
import { ycReturnPath } from "@/lib/yc/return-path"
import { staffReturnPath } from "@/lib/yc/staff-return-path"
import {
  completeStaffGoogle,
  STAFF_SESSION_COOKIE,
  STAFF_PROOF_SECONDS,
  staffCookieOptions,
} from "@/lib/yc/staff-session"

const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/

function buildRedirectUrl(origin: string, path: string): string {
  const base =
    process.env.VERCEL_ENV === "preview"
      ? origin
      : process.env.NEXT_PUBLIC_APP_URL || origin
  return new URL(path, base).toString()
}

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/"
  if (next.startsWith("/") && !next.startsWith("//")) return next
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next
  return "/"
}

type CallbackSupabase = Awaited<ReturnType<typeof createServerClient>>

/**
 * Ends the session of an account awaiting review and sends it to the pending
 * page, or back to signup when its review details are still missing.
 */
async function signupReviewResponse(
  supabase: CallbackSupabase,
  origin: string,
  user: User,
  detailsMissing: boolean,
  params: { requestedOffer?: string; next: string },
) {
  try {
    await supabase.auth.signOut()
  } catch {
    console.warn("Signup review sign-out failed")
  }
  let path = "/auth/pending"
  if (detailsMissing) {
    const signup = new URLSearchParams({ details: "required" })
    if (params.requestedOffer) signup.set("offer", params.requestedOffer)
    if (params.next !== "/") signup.set("next", params.next)
    path = `/auth/signup?${signup}`
  }
  const response = NextResponse.redirect(buildRedirectUrl(origin, path))
  response.cookies.delete(PLAN_OFFER_COOKIE)
  response.cookies.delete(SIGNUP_DETAILS_COOKIE)
  if (!detailsMissing)
    response.cookies.set(
      PENDING_PROFILE_COOKIE,
      encodePendingProfile({
        name: user.user_metadata?.full_name,
        email: user.email,
      }),
      pendingProfileCookieOptions,
    )
  return response
}

/**
 * Puts a new OAuth account into review with the details stashed on the signup
 * page, if any. The Slack notification waits until the details exist.
 */
async function holdForSignupReview(
  supabase: CallbackSupabase,
  origin: string,
  user: User,
  provider: string,
  signupAttemptId: string | undefined,
  eligibility: unknown,
  params: { requestedOffer?: string; next: string },
) {
  const details = await readStashedSignupDetails(signupAttemptId)
  try {
    await updateSignupReviewMetadata(user.id, {
      signup_review: "pending",
      ...(details ? { signup_request: storedSignupRequest(details) } : {}),
    })
  } catch (error) {
    console.error("Signup review hold failed", error)
    try {
      await supabase.auth.signOut()
    } catch {
      // The account is unusable until review succeeds; keep the error page.
    }
    return NextResponse.redirect(
      buildRedirectUrl(origin, "/auth/auth-code-error"),
    )
  }
  if (details)
    await notifySlackOfNewUser(
      user.email || "",
      user.user_metadata?.full_name || null,
      provider,
      normalizeSignupEligibilitySnapshot(eligibility),
      signupDetailsOffer(details),
      details,
    ).catch(() => {})
  return signupReviewResponse(supabase, origin, user, !details, params)
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const requestedOffer = normalizeRequestedOffer(searchParams.get("offer"))
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "invite"
    | "magiclink"
    | "email"
    | null
  let next = sanitizeNext(searchParams.get("next"))

  if (code || tokenHash) {
    const supabase = await createServerClient()
    let error = null
    let exchangedSession: Session | null = null
    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code)
      error = result.error
      exchangedSession = result.data?.session ?? null
    } else if (tokenHash && type) {
      const result = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
      error = result.error
    }

    if (error) {
      // Supabase's generic trigger error is not authoritative SS-499 policy
      // evidence. Preserve the existing rejected-auth redirect and report an
      // unavailable annotation rather than a definitive blocked outcome.
      const authSignupRejected = isGenericAuthSignupFailure(error.message)
      if (authSignupRejected) {
        console.warn("OAuth signup rejected by Auth trigger")
        await notifySlackOfNewUser(
          "",
          null,
          code ? "google" : "email",
          {
            kind: "unavailable",
          },
          requestedOffer,
        ).catch(() => {})
        return NextResponse.redirect(
          buildRedirectUrl(
            origin,
            "/auth/auth-code-error?reason=signup_blocked",
          ),
        )
      }
      console.error("Auth callback error:", error.message, {
        code: !!code,
        tokenHash: !!tokenHash,
        type,
      })
    }

    if (!error) {
      if (next === "/auth/reset-password" || type === "recovery") {
        return NextResponse.redirect(
          buildRedirectUrl(origin, "/auth/reset-password"),
        )
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      let newSignup = false
      if (user) {
        if (code && searchParams.has("staff_google_nonce")) {
          const staffProof = await completeStaffGoogle(
            exchangedSession,
            searchParams.get("staff_google_nonce"),
            user,
          )
          if (staffProof) {
            const response = NextResponse.redirect(
              buildRedirectUrl(origin, "/admin/yc"),
            )
            response.cookies.set(STAFF_SESSION_COOKIE, staffProof, {
              ...staffCookieOptions,
              maxAge: STAFF_PROOF_SECONDS,
            })
            response.cookies.delete(PLAN_OFFER_COOKIE)
            return response
          }
        }
        const signupAttemptId =
          searchParams.get("signup_attempt_id") || undefined
        const provider = code
          ? user.app_metadata?.provider || "google"
          : "email"

        const review = signupReviewMarker(user)
        if (review === "pending" || review === "rejected") {
          // A Google account first seen from sign-in returns here from the
          // signup page with its details; record them and announce it now.
          const details =
            review === "pending" && code && !readSignupRequest(user)
              ? await readStashedSignupDetails(signupAttemptId)
              : undefined
          if (details) {
            try {
              await updateSignupReviewMetadata(user.id, {
                signup_request: storedSignupRequest(details),
              })
              await notifySlackOfNewUser(
                user.email || "",
                user.user_metadata?.full_name || null,
                provider,
                { kind: "unavailable" },
                signupDetailsOffer(details),
                details,
              ).catch(() => {})
            } catch (error) {
              console.error("Signup review details update failed", error)
            }
          }
          return signupReviewResponse(
            supabase,
            origin,
            user,
            review === "pending" && !details && !readSignupRequest(user),
            { requestedOffer, next },
          )
        }
        // An account created outside the console's signup flows has no marker
        // but is still held; first-time Google accounts are held below.
        if (
          isSignupReviewBlocked(user) &&
          !(code && requiresSignupReview(user))
        )
          return signupReviewResponse(
            supabase,
            origin,
            user,
            !readSignupRequest(user),
            { requestedOffer, next },
          )
        // Approval mints a magic link (signup links need the password), which
        // confirms the address exactly like the original signup link.
        const signupLink =
          type === "signup" || (type === "magiclink" && review === "approved")
        let isNewUser = false
        let signupEligibilitySnapshot: unknown

        if (code && isGoogleUser(user)) {
          const originIntent = searchParams.get("google_signin_intent")
          if (originIntent) {
            // Preserve verified account provenance before fallible directory work.
            // The signed origin validates account creation independently of membership.
            try {
              await retainOriginalGoogleSignup(originIntent, user)
            } catch {
              console.warn("Google signup origin could not be retained")
            }
          }
          let directory: GoogleMembershipState
          try {
            directory = await classifyGoogleMembershipState(
              user.id,
              await completedMemberships(
                user.id,
                await listTeamMembershipsForUserDetailed(user.id, {
                  maxAgeMs: 0,
                }),
              ),
            )
          } catch {
            // Return a response so retained origin cookies survive lookup failures.
            directory = { kind: "indeterminate", degradedRegions: [] }
          }

          if (directory.kind === "indeterminate") {
            await trackEvent(AUTH_EVENTS.SIGN_IN_FAILED, user.id, {
              provider,
              email: user.email,
              reason: "membership_lookup_degraded",
            })
            console.warn("Google OAuth membership lookup degraded", {
              provider,
              stage: "callback",
              degradedRegions: directory.degradedRegions,
            })
            return NextResponse.redirect(
              buildRedirectUrl(
                origin,
                "/auth/auth-code-error?reason=membership_lookup_degraded",
              ),
            )
          }

          isNewUser = directory.kind === "first_time"

          if (isNewUser) {
            // Accept a legacy unscoped proof for OAuth flows that started
            // before this rollout; new flows must carry and match the signed
            // attempt ID for exact cross-provider correlation.
            const proofValid = signupAttemptId
              ? await hasValidGoogleSignupProof(signupAttemptId)
              : await hasValidLegacyGoogleSignupProof()
            if (!proofValid) {
              await trackEvent(
                AUTH_EVENTS.GOOGLE_SIGNUP_BYPASS_BLOCKED,
                user.id,
                {
                  reason: "missing_or_invalid_proof",
                  provider,
                },
              )
              console.warn("Google OAuth onboarding blocked", {
                reason: "missing_or_invalid_proof",
              })
              if (requiresSignupReview(user))
                return holdForSignupReview(
                  supabase,
                  origin,
                  user,
                  provider,
                  signupAttemptId,
                  undefined,
                  { requestedOffer, next },
                )
              const recoveryUrl = new URL("/auth/signup", origin)
              recoveryUrl.searchParams.set("complete_google", "1")
              if (requestedOffer)
                recoveryUrl.searchParams.set("offer", requestedOffer)
              if (next !== "/") recoveryUrl.searchParams.set("next", next)
              return NextResponse.redirect(
                buildRedirectUrl(
                  origin,
                  `${recoveryUrl.pathname}${recoveryUrl.search}`,
                ),
              )
            }
            console.info("Google OAuth signup proof validated at callback")
            await markGoogleSignupAttempt(signupAttemptId, user.id)
          }

          if (isNewUser && signupAttemptId) {
            const original = await readGooglePromotionEvidence(
              signupAttemptId,
              user.id,
              user.created_at,
            )
            if (!original || !original.originalSignup) {
              fingerprintDiagnostics({
                userId: user.id,
                signupAttemptId,
                captureAttemptId: original?.attemptId,
                eventId: original?.eventId,
                signupMethod: "google",
              }).record({
                stage: "attachment",
                outcome: "skipped",
                reason: original
                  ? "not_original_signup"
                  : "original_evidence_missing",
              })
            }
            if (original) {
              if (original.originalSignup) {
                try {
                  signupEligibilitySnapshot =
                    await publishOriginalSignupEvidence(
                      user,
                      original.attemptId,
                      original.routineMissing,
                      signupAttemptId,
                    )
                } catch {
                  // Publication is best effort; callback auth and notification
                  // continue with an unavailable eligibility annotation.
                  console.warn(
                    "Original signup promotion publication unavailable",
                  )
                }
              }
              if (original.eventId && original.visitor)
                await saveSignupEvidence(
                  user.id,
                  signupAttemptId,
                  original.eventId,
                  original.visitor,
                )
            }
          }
          if (isNewUser) {
            const activeAttempt =
              signupAttemptId &&
              (await isActiveSignupEvidenceAttempt(signupAttemptId))
            const fingerprintEventId = activeAttempt
              ? await readFingerprintSignupEventId()
              : undefined
            const existingVisitor = signupAttemptId
              ? await readSignupEvidence(user.id, signupAttemptId)
              : null
            if (fingerprintEventId && !existingVisitor && signupAttemptId) {
              let visitor: string | null = null
              try {
                visitor = await resolveFingerprintSignup({
                  eventId: fingerprintEventId,
                  userId: user.id,
                  signupMethod: "google",
                  signupAttemptId,
                })
              } finally {
                await consumeFingerprintSignupEventId(fingerprintEventId)
              }
              if (visitor) {
                try {
                  await saveSignupEvidence(
                    user.id,
                    signupAttemptId,
                    fingerprintEventId,
                    visitor,
                  )
                } catch {
                  console.warn("Signup evidence retention unavailable", {
                    stage: "google_callback",
                  })
                }
              }
            }
            if (signupAttemptId) {
              await trackEvent(AUTH_EVENTS.SIGNUP_ATTEMPT_ASSOCIATED, user.id, {
                signup_attempt_id: signupAttemptId,
                superserve_user_id: user.id,
                signup_method: "google",
                observed_at: new Date().toISOString(),
              })
            }
          }
        } else {
          const createdAt = new Date(user.created_at)
          isNewUser = Date.now() - createdAt.getTime() < 30000
        }

        if (signupLink) {
          const attempt = searchParams.get("device_attempt_id")
          const proof = searchParams.get("device_bind_proof")
          if (
            attempt &&
            proof &&
            validSignupDeviceBinding(user.id, attempt, proof)
          ) {
            try {
              signupEligibilitySnapshot = await publishOriginalSignupEvidence(
                user,
                attempt,
                false,
              )
            } catch {
              console.warn("Original signup promotion publication unavailable")
            }
          }
        }

        newSignup = type !== "invite" && (signupLink || isNewUser)
        if (type !== "invite" && (signupLink || (code && isNewUser))) {
          const directory = await completedMemberships(
            user.id,
            await listTeamMembershipsForUserDetailed(user.id, {
              maxAgeMs: 0,
            }),
          )
          if (
            directory.memberships.length === 0 &&
            directory.degradedRegions.length > 0
          )
            return NextResponse.redirect(
              buildRedirectUrl(
                origin,
                "/auth/auth-code-error?reason=membership_lookup_degraded",
              ),
            )
          if (
            directory.memberships.length === 0 &&
            directory.degradedRegions.length === 0
          ) {
            try {
              const entries = signupAttemptId
                ? await readSignupEvidenceEntries(user.id, signupAttemptId)
                : []
              if (entries.length === 0)
                await evaluateSignupRestriction(DEFAULT_REGION, user.id, null)
              for (const visitor of new Set(
                entries.map(({ visitor }) => visitor),
              ))
                await evaluateSignupRestriction(
                  DEFAULT_REGION,
                  user.id,
                  visitor,
                )
            } catch (error) {
              if (error instanceof SignupRestrictedError) {
                await notifySlackOfNewUser(
                  user.email || "",
                  user.user_metadata?.full_name || null,
                  provider,
                  { kind: "blocked" },
                  requestedOffer,
                ).catch(() => {})
                return NextResponse.redirect(
                  buildRedirectUrl(
                    origin,
                    "/auth/auth-code-error?reason=signup_blocked",
                  ),
                )
              }
              throw error
            }
          }
        }

        if (code && isNewUser && requiresSignupReview(user))
          return holdForSignupReview(
            supabase,
            origin,
            user,
            provider,
            signupAttemptId,
            signupEligibilitySnapshot,
            { requestedOffer, next },
          )

        if (isNewUser) {
          // Reviewed accounts were announced when they entered review.
          if (!review)
            await notifySlackOfNewUser(
              user.email || "",
              user.user_metadata?.full_name || null,
              provider,
              normalizeSignupEligibilitySnapshot(signupEligibilitySnapshot),
              requestedOffer,
            ).catch(() => {})
          Promise.resolve(
            sendWelcomeEmail(
              user.email || "",
              user.user_metadata?.full_name || "there",
            ),
          ).catch(() => {})
        }

        await trackEvent(
          isNewUser
            ? AUTH_EVENTS.SIGN_UP_COMPLETED
            : AUTH_EVENTS.SIGN_IN_COMPLETED,
          user.id,
          {
            provider,
            email: user.email,
            is_new_user: isNewUser,
            ...(isNewUser && requestedOffer
              ? { requested_offer: requestedOffer }
              : {}),
          },
        )

        const ycNext =
          ycReturnPath(next) ??
          (process.env.YC_STAFF_UI_ENABLED === "true"
            ? staffReturnPath(next)
            : null)
        if (
          !next.startsWith("/device") &&
          !next.startsWith("https://") &&
          !/^\/onboarding\/plan\/?(?:\?|$)/.test(next) &&
          !ycNext
        ) {
          next = "/sandboxes"
        }
        if (ycNext) next = ycNext
        if (
          next === "/sandboxes" &&
          (await cookies()).get("yc_claim_confirmation")
        ) {
          next = "/yc/claim"
        }
      }

      const response = NextResponse.redirect(
        next.startsWith("https://") ? next : buildRedirectUrl(origin, next),
      )
      if (user && newSignup && requestedOffer) {
        response.cookies.set(
          PLAN_OFFER_COOKIE,
          JSON.stringify({ userId: user.id, offer: requestedOffer }),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: new URL(request.url).protocol === "https:",
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
          },
        )
      }
      if (!newSignup || !requestedOffer)
        response.cookies.delete(PLAN_OFFER_COOKIE)
      return response
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
