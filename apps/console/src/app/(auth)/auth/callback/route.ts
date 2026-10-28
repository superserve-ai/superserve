import type { Session, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  consumeFingerprintSignupEventId,
  readFingerprintSignupEventId,
  sendWelcomeEmail,
} from "@/app/(auth)/auth/signup/action"
import { publishOriginalSignupEvidence } from "@/lib/api/promotion-publication"
import { signupEntryDestination } from "@/lib/api/signup-checkout"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { SignupSetupBlockedError } from "@/lib/api/signup-setup-error"
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
  revokeGoogleSignupAuthorization,
} from "@/lib/auth/google-signup-proof"
import { PLAN_OFFER_COOKIE } from "@/lib/auth/plan-preselection"
import { normalizeSignupRequestedOffer } from "@/lib/auth/requested-offer"
import {
  isActiveSignupEvidenceAttempt,
  readSignupEvidence,
  readSignupEvidenceEntries,
  saveSignupEvidence,
} from "@/lib/auth/signup-evidence"
import {
  parseSignupOffer,
  isSelfServeSignupOffer,
  SIGNUP_OFFER_DESTINATIONS,
  SIGNUP_OFFER_PARAM,
} from "@/lib/auth/signup-offer"
import {
  evaluateSignupRestriction,
  SignupRestrictedError,
} from "@/lib/auth/signup-restrictions"
import {
  hasPendingEnterprisePricing,
  isSignupReviewBlocked,
  signupReviewStatus,
} from "@/lib/auth/signup-review"
import {
  encodePendingProfile,
  PENDING_PROFILE_COOKIE,
  pendingProfileCookieOptions,
  updateSignupReviewMetadata,
} from "@/lib/auth/signup-review-server"
import {
  getPricingVersionAction,
  getPublicBillingPlansAction,
} from "@/lib/billing/plans-actions"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
  signupPreparationReturnPath,
} from "@/lib/billing/pro-auth-return"
import {
  isSignupCheckoutOffer,
  isPlanPickerPath,
  isSignupCheckoutPath,
  isSignupCheckoutReturnPath,
} from "@/lib/billing/signup-checkout-paths"
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

/** Ends the session of an account awaiting Enterprise setup. */
async function pendingSignupResponse(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  origin: string,
  user: User,
) {
  try {
    await supabase.auth.signOut()
  } catch {
    console.warn("Pending signup sign-out failed")
  }
  const response = NextResponse.redirect(
    buildRedirectUrl(origin, "/auth/pending"),
  )
  response.cookies.delete(PLAN_OFFER_COOKIE)
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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const requestedOffer = normalizeSignupRequestedOffer(
    searchParams.get("offer"),
  )
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
        const pendingEnterprisePricing = hasPendingEnterprisePricing(user)
        if (
          isSignupReviewBlocked(user) &&
          (!pendingEnterprisePricing ||
            signupReviewStatus(user) === "pending" ||
            signupReviewStatus(user) === "rejected")
        )
          return pendingSignupResponse(supabase, origin, user)
        let offerIntent = pendingEnterprisePricing
          ? "enterprise"
          : (searchParams.get(SIGNUP_OFFER_PARAM) ?? searchParams.get("offer"))
        let enterprisePricing: "legacy" | "v2" | undefined
        let provenExistingGoogle: GoogleMembershipState | undefined
        if (offerIntent === "enterprise") {
          try {
            enterprisePricing = (await getPublicBillingPlansAction())
              .pricing_version
          } catch {
            if (code && isGoogleUser(user) && !pendingEnterprisePricing) {
              try {
                const memberships = await completedMemberships(
                  user.id,
                  await listTeamMembershipsForUserDetailed(user.id, {
                    maxAgeMs: 0,
                  }),
                )
                if (memberships.degradedRegions.length)
                  throw new Error("Enterprise membership unavailable")
                const directory = await classifyGoogleMembershipState(
                  user.id,
                  memberships,
                )
                // A query cannot place an existing customer on hold. Persist only
                // after a complete directory read proves this account is new.
                if (directory.kind === "indeterminate")
                  throw new Error("Enterprise membership unavailable")
                if (directory.kind === "existing") {
                  provenExistingGoogle = directory
                  // Existing membership already authorizes this account's
                  // sign-in; a fresh signup preference cannot revoke it.
                  offerIntent = null
                } else if (
                  directory.kind === "first_time" &&
                  !signupReviewStatus(user)
                ) {
                  await updateSignupReviewMetadata(user.id, {
                    signup_enterprise_pricing_pending: true,
                  })
                }
              } catch {
                await revokeGoogleSignupAuthorization(
                  user.id,
                  searchParams.get("signup_attempt_id") || undefined,
                ).catch(() => {})
              }
            }
            if (!provenExistingGoogle) {
              await supabase.auth.signOut().catch(() => {})
              return NextResponse.redirect(
                buildRedirectUrl(
                  origin,
                  "/auth/auth-code-error?reason=pricing_unavailable&signup_offer=enterprise",
                ),
              )
            }
          }
          if (pendingEnterprisePricing) {
            await updateSignupReviewMetadata(user.id, {
              signup_enterprise_pricing_pending: false,
              ...(enterprisePricing === "v2"
                ? { signup_review: "pending" }
                : {}),
            })
            if (enterprisePricing === "v2")
              return pendingSignupResponse(supabase, origin, user)
          }
        }
        const signupOffer =
          offerIntent &&
          (isSelfServeSignupOffer(offerIntent) ||
            (enterprisePricing ?? (await getPricingVersionAction())) === "v2")
            ? parseSignupOffer(offerIntent)
            : undefined
        // Authentication has consumed the code/token before directory reads.
        // Keep only bounded navigation intent so a transient read can resume
        // through fresh actor/team/policy checks without replaying that token.
        const preparationReturn = signupPreparationReturnPath(next)
        const preparationIntent = preparationReturn
          ? new URL(preparationReturn, origin).searchParams
          : null
        const directPaidNext =
          proAuthReturnPath(next) ?? starterAuthReturnPath(next)
        const defaultPaidNext =
          (!searchParams.get("next") || searchParams.get("next") === "/") &&
          !(await cookies()).get("yc_claim_confirmation") &&
          (signupOffer === "starter" || signupOffer === "pro_monthly")
            ? SIGNUP_OFFER_DESTINATIONS[signupOffer]
            : null
        let retryPaidNext =
          preparationIntent?.get("next") ?? directPaidNext ?? defaultPaidNext
        // A preparation return can pin its team outside the nested paid URL.
        // Carry that locator into the retry rather than falling back to the
        // browser's newly selected team after the directory recovers.
        if (retryPaidNext && preparationIntent?.get("team")) {
          const paid = new URL(retryPaidNext, origin)
          paid.searchParams.set("team", preparationIntent.get("team")!)
          retryPaidNext = paid.pathname + paid.search
        }
        const paidSetupRecovery =
          signupOffer !== "enterprise" &&
          !pendingEnterprisePricing &&
          retryPaidNext
            ? `/auth/auth-code-error?${new URLSearchParams({
                reason: "account_setup",
                account: preparationIntent?.get("account") ?? user.id,
                next: retryPaidNext,
              })}`
            : null
        const membershipFailureResponse = (googleProofRecovery = false) => {
          if (googleProofRecovery && paidSetupRecovery) {
            // The directory has not established a new Google account yet, so
            // its pre-auth proof must remain unbound. Resume through signup's
            // proof gate rather than repeatedly attempting first-team setup.
            const saved = new URL(paidSetupRecovery, origin).searchParams
            const preparation = `/api/onboarding/prepare/?${new URLSearchParams(
              {
                account: saved.get("account")!,
                next: saved.get("next")!,
              },
            )}`
            return NextResponse.redirect(
              buildRedirectUrl(
                origin,
                `/auth/signup?${new URLSearchParams({ complete_google: "1", next: preparation })}`,
              ),
            )
          }
          return NextResponse.redirect(
            buildRedirectUrl(
              origin,
              paidSetupRecovery ??
                "/auth/auth-code-error?reason=membership_lookup_degraded",
            ),
          )
        }
        const signupAttemptId =
          searchParams.get("signup_attempt_id") || undefined
        const provider = code
          ? user.app_metadata?.provider || "google"
          : "email"
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
            directory =
              provenExistingGoogle ??
              (await classifyGoogleMembershipState(
                user.id,
                await completedMemberships(
                  user.id,
                  await listTeamMembershipsForUserDetailed(user.id, {
                    maxAgeMs: 0,
                  }),
                ),
              ))
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
            return membershipFailureResponse(true)
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
              const recoveryUrl = new URL("/auth/signup", origin)
              recoveryUrl.searchParams.set("complete_google", "1")
              if (requestedOffer)
                recoveryUrl.searchParams.set("offer", requestedOffer)
              const signupOfferParam = offerIntent
              if (signupOfferParam)
                recoveryUrl.searchParams.set(
                  SIGNUP_OFFER_PARAM,
                  signupOfferParam,
                )
              if (next !== "/") recoveryUrl.searchParams.set("next", next)
              return NextResponse.redirect(
                buildRedirectUrl(
                  origin,
                  `${recoveryUrl.pathname}${recoveryUrl.search}`,
                ),
              )
            }
            console.info("Google OAuth signup proof validated at callback")
            if (signupOffer === "enterprise") {
              try {
                await updateSignupReviewMetadata(user.id, {
                  signup_review: "pending",
                })
              } catch (holdError) {
                console.error("Enterprise signup hold failed", holdError)
                await revokeGoogleSignupAuthorization(
                  user.id,
                  signupAttemptId,
                ).catch((error) =>
                  console.error(
                    "Enterprise signup proof cleanup failed",
                    error,
                  ),
                )
                await supabase.auth.signOut().catch(() => {})
                return NextResponse.redirect(
                  buildRedirectUrl(origin, "/auth/auth-code-error"),
                )
              }
            }
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

        if (type === "signup") {
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

        newSignup = type !== "invite" && (type === "signup" || isNewUser)
        if (type !== "invite" && (type === "signup" || (code && isNewUser))) {
          let directory: Awaited<ReturnType<typeof completedMemberships>>
          try {
            directory = await completedMemberships(
              user.id,
              await listTeamMembershipsForUserDetailed(user.id, {
                maxAgeMs: 0,
              }),
            )
          } catch {
            return membershipFailureResponse()
          }
          if (
            directory.memberships.length === 0 &&
            directory.degradedRegions.length > 0
          )
            return membershipFailureResponse()
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

        if (code && isNewUser && signupOffer === "enterprise") {
          await notifySlackOfNewUser(
            user.email || "",
            user.user_metadata?.full_name || null,
            provider,
            normalizeSignupEligibilitySnapshot(signupEligibilitySnapshot),
            requestedOffer,
            true,
          ).catch(() => {})
          return pendingSignupResponse(supabase, origin, user)
        }

        if (isNewUser) {
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

        const proNext = proAuthReturnPath(next) ?? starterAuthReturnPath(next)
        const preparationNext = signupPreparationReturnPath(next)
        const ycNext =
          ycReturnPath(next) ??
          (process.env.YC_STAFF_UI_ENABLED === "true"
            ? staffReturnPath(next)
            : null)
        if (
          !next.startsWith("/device") &&
          !next.startsWith("https://") &&
          !/^\/onboarding\/plan\/?(?:\?|$)/.test(next) &&
          !isSignupCheckoutPath(next) &&
          !isSignupCheckoutReturnPath(next) &&
          !isPlanPickerPath(next) &&
          !ycNext &&
          !proNext &&
          !preparationNext
        ) {
          next = "/sandboxes"
        }
        if (ycNext) next = ycNext
        if (proNext) next = proNext
        if (preparationNext) next = preparationNext
        if (
          next === "/sandboxes" &&
          (await cookies()).get("yc_claim_confirmation")
        ) {
          next = "/yc/claim"
        }
        if (
          signupOffer &&
          next === "/sandboxes" &&
          (!searchParams.get("next") || searchParams.get("next") === "/") &&
          (newSignup || signupOffer !== "enterprise")
        )
          next = SIGNUP_OFFER_DESTINATIONS[signupOffer]
        if (
          newSignup &&
          (proAuthReturnPath(next) || starterAuthReturnPath(next))
        ) {
          // First-team setup must finish while this route can write cookies.
          // Otherwise the dashboard's generic preparation redirect discards
          // the selected payment page before assigning the initial Free plan.
          try {
            await getSignupPlanAction(
              new URL(next, origin).searchParams.get("team") ?? undefined,
              user.id,
              undefined,
              next,
            )
          } catch (error) {
            const recovery = new URLSearchParams({
              reason:
                error instanceof SignupSetupBlockedError
                  ? error.reason
                  : "account_setup",
              account: user.id,
              next,
            })
            return NextResponse.redirect(
              buildRedirectUrl(origin, `/auth/auth-code-error?${recovery}`),
            )
          }
        }
        const checkoutOffer = isSignupCheckoutOffer(signupOffer)
          ? signupOffer
          : undefined
        if (
          newSignup &&
          (checkoutOffer || !signupOffer || signupOffer === "free") &&
          (next === "/sandboxes" ||
            (signupOffer && next === SIGNUP_OFFER_DESTINATIONS[signupOffer])) &&
          (await getPricingVersionAction()) === "v2"
        ) {
          next =
            (await signupEntryDestination(user, checkoutOffer).catch(
              () => null,
            )) ?? next
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
