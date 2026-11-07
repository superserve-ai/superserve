"use server"

import crypto from "node:crypto"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { after } from "next/server"
import * as z from "zod"

import { createPromotionSignupAttempt } from "@/lib/api/promotion-device-evidence"
import { publishOriginalSignupEvidence } from "@/lib/api/promotion-publication"
import { deviceReturnPath } from "@/lib/auth/device-return-path"
import { isGenericAuthSignupFailure } from "@/lib/auth/errors"
import {
  claimGoogleSignupRecovery,
  issueGoogleSignupProof,
} from "@/lib/auth/google-signup-proof"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import { normalizeSignupRequestedOffer } from "@/lib/auth/requested-offer"
import {
  beginSignupEvidenceAttempt,
  isSupersededSignupEvidenceAttempt,
  saveSignupEvidence,
} from "@/lib/auth/signup-evidence"
import {
  parseSignupOffer,
  isSelfServeSignupOffer,
  SIGNUP_OFFER_PARAM,
} from "@/lib/auth/signup-offer"
import {
  clearSignupResendTicket,
  readSignupResendTicket,
  saveSignupResendTicket,
} from "@/lib/auth/signup-resend"
import {
  evaluateSignupRestriction,
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
import {
  getPricingVersionAction,
  getPublicBillingPlansAction,
} from "@/lib/billing/plans-actions"
import {
  proAuthReturnPath,
  starterAuthReturnPath,
} from "@/lib/billing/pro-auth-return"
import { DEFAULT_REGION } from "@/lib/cells"
import {
  isCloudflareSignupObservationEnabled as readCloudflareObservationFlag,
  observeCloudflareSignup,
} from "@/lib/cloudflare/signup-observe"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { WelcomeEmail } from "@/lib/email/templates/welcome"
import { signSignupDeviceBinding } from "@/lib/fingerprint/binding-proof"
import type { SignupFingerprintResult } from "@/lib/fingerprint/client"
import { FINGERPRINT_SIGNUP_COOKIE } from "@/lib/fingerprint/constants"
import type { BrowserFingerprintDiagnostics } from "@/lib/fingerprint/diagnostics"
import { fingerprintDiagnostics } from "@/lib/fingerprint/diagnostics-server"
import {
  observeFingerprintSignup,
  resolveFingerprintSignup,
} from "@/lib/fingerprint/observe"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { verifyRecaptcha } from "@/lib/recaptcha/verify"
import { normalizeSignupEligibilitySnapshot } from "@/lib/slack/signup-eligibility"
import { notifySlackOfNewUser } from "@/lib/slack/signup-notification"
import { createAdminClient } from "@/lib/supabase/admin"
import { ycReturnPath } from "@/lib/yc/return-path"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
})

/** True once for the recovery mark this browser's failed callback set. */
export async function claimGoogleRecoveryContinuation(
  reason: string,
): Promise<boolean> {
  return claimGoogleSignupRecovery(reason)
}

export async function isCloudflareSignupObservationEnabled(): Promise<boolean> {
  return Promise.race([
    readCloudflareObservationFlag(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 750)),
  ])
}

export async function createSignupFingerprintAttempt() {
  return createPromotionSignupAttempt()
}

export async function scheduleCloudflareObservation(
  signupAttemptId: string,
  signupMethod: "email" | "google",
  userId?: string | null,
  teamId?: string | null,
  clientContext?: {
    userAgent?: string | null
    ip?: string | null
    ray?: string | null
  },
  turnstileToken?: string | null,
) {
  try {
    after(() =>
      observeCloudflareSignup({
        signupAttemptId,
        signupMethod,
        userId,
        teamId,
        clientContext,
        turnstileToken,
      }),
    )
  } catch {
    // Cloudflare is strictly telemetry-only.
  }
}

async function readCloudflareClientContext() {
  try {
    const requestHeaders = await headers()
    return {
      userAgent: requestHeaders.get("user-agent"),
      ip:
        requestHeaders.get("cf-connecting-ip") ||
        requestHeaders.get("x-forwarded-for"),
      ray: requestHeaders.get("cf-ray"),
    }
  } catch {
    return undefined
  }
}

export async function readFingerprintSignupEventId(): Promise<
  string | undefined
> {
  try {
    const store = await cookies()
    const encodedEventId = store.get(FINGERPRINT_SIGNUP_COOKIE)?.value
    if (!encodedEventId) return undefined

    try {
      return decodeURIComponent(encodedEventId)
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

export async function consumeFingerprintSignupEventId(eventId: string) {
  try {
    const store = await cookies()
    const current = store.get(FINGERPRINT_SIGNUP_COOKIE)?.value
    if (current && decodeURIComponent(current) === eventId)
      store.delete(FINGERPRINT_SIGNUP_COOKIE)
  } catch {
    // The event cookie is optional; cleanup must not interrupt signup.
  }
}

export async function scheduleFingerprintObservation(
  eventId: string | undefined,
  signupMethod: "email" | "google",
  userId?: string | null,
  signupAttemptId?: string,
) {
  if (!eventId) return
  try {
    after(() =>
      observeFingerprintSignup({
        eventId,
        signupMethod,
        ...(userId !== undefined ? { userId } : {}),
        ...(signupAttemptId ? { signupAttemptId } : {}),
      }),
    )
  } catch (error) {
    // Scheduling is telemetry-only; an unavailable request lifecycle hook
    // must never change signup behavior.
    console.warn("Fingerprint observation scheduling failed open", {
      eventId,
      error: error instanceof Error ? error.message : "unknown_error",
    })
  }
}

export const beginGoogleSignup = async (
  recaptchaToken?: string,
  turnstileToken?: string,
  captureResult?: SignupFingerprintResult,
  browserDiagnostics?: BrowserFingerprintDiagnostics,
): Promise<
  | { success: true; signupAttemptId: string }
  | {
      success: false
      error: string
      errorCode: "captcha_failed" | "proof_unavailable"
    }
> => {
  const capture =
    captureResult && "attemptId" in captureResult ? captureResult : undefined
  const signupAttemptId = crypto.randomUUID()
  await beginSignupEvidenceAttempt(signupAttemptId)
  const clientContext = await readCloudflareClientContext()
  const fingerprintEventId =
    capture?.eventId ?? (await readFingerprintSignupEventId())
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId,
    signupMethod: "google",
    captureAttemptId: capture?.attemptId,
    eventId: fingerprintEventId,
  })
  diagnostic.browser(browserDiagnostics)
  diagnostic.record({
    stage: "submission",
    outcome: "succeeded",
    reason: capture
      ? "capture_present"
      : captureResult
        ? "capture_unavailable"
        : "capture_absent",
  })
  scheduleCloudflareObservation(
    signupAttemptId,
    "google",
    undefined,
    undefined,
    clientContext,
    turnstileToken,
  )
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup_google")
  await trackEvent(AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED, signupAttemptId, {
    provider: "recaptcha",
    signup_attempt_id: signupAttemptId,
    signup_method: "google",
    verified: recaptcha.verified,
    provider_outcome: recaptcha.providerOutcome,
    reason: "reason" in recaptcha ? recaptcha.reason : null,
    score: recaptcha.score,
    recaptcha_assessment_id: recaptcha.assessmentId ?? null,
    recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
    observed_at: new Date().toISOString(),
  })
  if (!recaptcha.verified) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    await scheduleFingerprintObservation(
      fingerprintEventId,
      "google",
      null,
      signupAttemptId,
    )
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason: recaptcha.reason,
        stage: "captcha_verification",
      },
    )
    console.warn("Google signup blocked by reCAPTCHA", {
      reason: recaptcha.reason,
    })
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed" as const,
    }
  }

  try {
    let verified = false
    let attestationFailed = false
    const visitor = fingerprintEventId
      ? await resolveFingerprintSignup({
          eventId: fingerprintEventId,
          signupMethod: "google",
          signupAttemptId,
          capture,
          onAttested: () => {
            verified = true
          },
          onAttestationFailed: () => {
            attestationFailed = true
          },
        })
      : null
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    await issueGoogleSignupProof(signupAttemptId, {
      attemptId: verified ? capture?.attemptId : undefined,
      eventId: fingerprintEventId,
      visitor: visitor ?? undefined,
      // Missing capture is governed by the backend evidence-required policy.
      // Attestation or publication outages remain authority failures.
      routineMissing: !verified && !attestationFailed,
    })
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_VERIFIED,
      signupAttemptId,
      {
        stage: "captcha_verification",
      },
    )
    console.info("Google signup CAPTCHA verified; pre-auth proof issued")
    return { success: true, signupAttemptId }
  } catch (error) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    await trackEvent(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason:
          error instanceof Error ? error.message : "proof_issuance_failed",
        stage: "proof_issuance",
      },
    )
    console.error("Google signup proof issuance failed", error)
    return {
      success: false,
      error: "Google signup is temporarily unavailable. Please try again.",
      errorCode: "proof_unavailable" as const,
    }
  }
}

const CONFIRMATION_NOT_SENT_MESSAGE =
  "Your account was created, but we couldn't send the confirmation email."
const RESEND_COOLDOWN_SECONDS = 60

function confirmationUrl(
  redirectTo: string,
  tokenHash: string,
  type: string,
  signupAttemptId: string,
  binding?: { user: string; device: string },
): string {
  const confirmation = new URL(redirectTo)
  confirmation.searchParams.set("token_hash", tokenHash)
  confirmation.searchParams.set("type", type)
  confirmation.searchParams.set("signup_attempt_id", signupAttemptId)
  confirmation.searchParams.set("utm_source", "email")
  confirmation.searchParams.set("utm_medium", "signup_confirmation")
  if (binding) {
    const proof = signSignupDeviceBinding(binding.user, binding.device)
    if (proof) {
      confirmation.searchParams.set("device_attempt_id", binding.device)
      confirmation.searchParams.set("device_bind_proof", proof)
    }
  }
  return confirmation.toString()
}

async function sendConfirmationEmail(
  to: string,
  confirmationUrl: string,
): Promise<boolean> {
  const result = await sendEmail({
    to,
    subject: "Confirm your Superserve account",
    react: ConfirmationEmail({ confirmationUrl }),
  })
  return result.success
}

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
  recaptchaToken?: string,
  turnstileToken?: string,
  captureResult?: SignupFingerprintResult,
  offer?: string,
  browserDiagnostics?: BrowserFingerprintDiagnostics,
  ycNext?: string,
  rawSignupOffer?: string,
) => {
  const requestedOffer = normalizeSignupRequestedOffer(offer)
  const parsed = signUpSchema.safeParse({ email, password, fullName })
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }

  const capture =
    captureResult && "attemptId" in captureResult ? captureResult : undefined
  const signupAttemptId = crypto.randomUUID()
  const evidenceAttemptStarted =
    await beginSignupEvidenceAttempt(signupAttemptId)
  const clientContext = await readCloudflareClientContext()
  const fingerprintEventId =
    capture?.eventId ?? (await readFingerprintSignupEventId())
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId,
    signupMethod: "email",
    captureAttemptId: capture?.attemptId,
    eventId: fingerprintEventId,
  })
  diagnostic.browser(browserDiagnostics)
  diagnostic.record({
    stage: "submission",
    outcome: "succeeded",
    reason: capture
      ? "capture_present"
      : captureResult
        ? "capture_unavailable"
        : "capture_absent",
  })
  scheduleCloudflareObservation(
    signupAttemptId,
    "email",
    undefined,
    undefined,
    clientContext,
    turnstileToken,
  )
  let fingerprintObservationScheduled = false
  let observationUserId: string | null = null
  const emitFingerprintObservation = (userId?: string | null) => {
    if (!fingerprintEventId || fingerprintObservationScheduled) return
    fingerprintObservationScheduled = true
    scheduleFingerprintObservation(
      fingerprintEventId,
      "email",
      userId,
      signupAttemptId,
    )
  }

  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup")
  await trackEvent(AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED, signupAttemptId, {
    provider: "recaptcha",
    signup_attempt_id: signupAttemptId,
    signup_method: "email",
    verified: recaptcha.verified,
    provider_outcome: recaptcha.providerOutcome,
    reason: "reason" in recaptcha ? recaptcha.reason : null,
    score: recaptcha.score,
    recaptcha_assessment_id: recaptcha.assessmentId ?? null,
    recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
    observed_at: new Date().toISOString(),
  })
  if (!recaptcha.verified) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    emitFingerprintObservation()
    console.warn("Signup blocked by reCAPTCHA", {
      email: parsed.data.email,
      reason: recaptcha.reason,
    })
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed" as const,
    }
  }

  try {
    let visitor: string | null = null
    let deviceVerified = false
    let attestationFailed = false
    if (fingerprintEventId) {
      try {
        visitor = await resolveFingerprintSignup({
          eventId: fingerprintEventId,
          signupMethod: "email",
          signupAttemptId,
          getObservationUserId: () => observationUserId,
          capture,
          onAttested: () => {
            deviceVerified = true
          },
          onAttestationFailed: () => {
            attestationFailed = true
          },
        })
      } finally {
        await consumeFingerprintSignupEventId(fingerprintEventId)
      }
    }
    if (fingerprintEventId) fingerprintObservationScheduled = true
    if (
      visitor &&
      (!evidenceAttemptStarted ||
        !(await isSupersededSignupEvidenceAttempt(signupAttemptId)))
    ) {
      try {
        await evaluateSignupRestriction(
          DEFAULT_REGION,
          signupAttemptId,
          visitor,
        )
      } catch (error) {
        if (error instanceof SignupRestrictedError) {
          await notifySlackOfNewUser(
            parsed.data.email,
            parsed.data.fullName,
            "email",
            { kind: "blocked" },
            requestedOffer,
          ).catch(() => {})
          return { success: false, error: SIGNUP_RESTRICTED_MESSAGE }
        }
        throw error
      }
    }

    const supabase = createAdminClient()
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const callbackUrl = new URL("/auth/callback", appUrl)
    const next =
      proAuthReturnPath(ycNext ?? null) ??
      starterAuthReturnPath(ycNext ?? null) ??
      ycReturnPath(ycNext) ??
      deviceReturnPath(ycNext) ??
      inviteReturnPath(ycNext)
    if (next) callbackUrl.searchParams.set("next", next)
    if (requestedOffer) callbackUrl.searchParams.set("offer", requestedOffer)
    const offerIntent = rawSignupOffer ?? offer
    let pricingVersion: "legacy" | "v2" | undefined
    if (offerIntent === "enterprise") {
      try {
        pricingVersion = (await getPublicBillingPlansAction()).pricing_version
      } catch {
        return {
          success: false,
          error: "Pricing is unavailable. Please try signing up again.",
        }
      }
    } else if (offerIntent) pricingVersion = await getPricingVersionAction()
    const signupOffer =
      offerIntent && pricingVersion === "v2"
        ? parseSignupOffer(offerIntent)
        : undefined
    const routingOffer =
      signupOffer ??
      (offerIntent === "enterprise" ? "enterprise" : undefined) ??
      (isSelfServeSignupOffer(offerIntent)
        ? parseSignupOffer(offerIntent)
        : undefined)
    if (routingOffer)
      callbackUrl.searchParams.set(SIGNUP_OFFER_PARAM, routingOffer)
    const redirectTo = callbackUrl.toString()
    const signupStartedAt = Date.now()
    const awaitingEnterpriseSetup = signupOffer === "enterprise"
    const created = awaitingEnterpriseSetup
      ? await supabase.auth.admin.createUser({
          email: parsed.data.email,
          password: parsed.data.password,
          email_confirm: false,
          user_metadata: {
            full_name: parsed.data.fullName,
            signup_attempt_id: signupAttemptId,
          },
          app_metadata: { signup_review: "pending" },
        })
      : null
    const { data, error } = created?.error
      ? { data: { user: null, properties: null }, error: created.error }
      : await supabase.auth.admin.generateLink(
          awaitingEnterpriseSetup
            ? {
                type: "magiclink",
                email: parsed.data.email,
                options: { redirectTo },
              }
            : {
                type: "signup",
                email: parsed.data.email,
                password: parsed.data.password,
                options: {
                  data: {
                    full_name: parsed.data.fullName,
                    signup_attempt_id: signupAttemptId,
                  },
                  redirectTo,
                },
              },
        )
    observationUserId = data?.user?.id ?? null

    if (error) {
      emitFingerprintObservation()
      if (error.message.includes("already registered")) {
        return {
          success: false,
          error: "An account with this email already exists.",
        }
      }
      // Auth exposes trigger failures as a generic database error. It keeps
      // the existing rejected-auth result, but does not prove SS-499 blocked
      // policy evidence, so the notification must remain unavailable.
      if (isGenericAuthSignupFailure(error.message)) {
        console.warn("Signup rejected by Auth trigger", {
          email: parsed.data.email,
        })
        await notifySlackOfNewUser(
          parsed.data.email,
          parsed.data.fullName,
          "email",
          { kind: "unavailable" },
          requestedOffer,
        ).catch(() => {})
        return {
          success: false,
          error: "Signup is not available for this email address.",
          errorCode: "blocked_email" as const,
        }
      }
      return { success: false, error: error.message }
    }

    const originalSignup =
      data?.user && Date.parse(data.user.created_at) >= signupStartedAt
    let signupEligibilitySnapshot: unknown
    if (originalSignup) {
      try {
        signupEligibilitySnapshot = await publishOriginalSignupEvidence(
          data.user,
          deviceVerified ? capture?.attemptId : undefined,
          !deviceVerified && !attestationFailed,
          signupAttemptId,
        )
      } catch {
        // Publication is best effort; an unavailable snapshot must not change
        // the Auth signup result or suppress the original notification.
        console.warn("Original signup promotion publication unavailable")
      }
    }
    if (fingerprintEventId && visitor && data?.user?.id) {
      try {
        await saveSignupEvidence(
          data.user.id,
          signupAttemptId,
          fingerprintEventId,
          visitor,
        )
      } catch {
        console.warn("Signup evidence retention unavailable", {
          stage: "email_signup",
        })
      }
    }
    await trackEvent(
      AUTH_EVENTS.SIGNUP_ATTEMPT_ASSOCIATED,
      data?.user?.id || signupAttemptId,
      {
        signup_attempt_id: signupAttemptId,
        superserve_user_id: data?.user?.id ?? null,
        signup_method: "email",
        observed_at: new Date().toISOString(),
      },
    )

    const tokenHash = data?.properties?.hashed_token
    if (!tokenHash)
      return { success: false, error: "Failed to generate confirmation link." }
    const linkType = awaitingEnterpriseSetup
      ? data.properties.verification_type
      : "signup"
    const device =
      originalSignup && deviceVerified && capture
        ? capture.attemptId
        : undefined
    if (data.user && (linkType === "signup" || linkType === "magiclink"))
      await saveSignupResendTicket({
        user: data.user.id,
        type: linkType,
        redirect: redirectTo,
        attempt: signupAttemptId,
        ...(device ? { device } : {}),
      })
    const emailSent = await sendConfirmationEmail(
      parsed.data.email,
      confirmationUrl(
        redirectTo,
        tokenHash,
        linkType,
        signupAttemptId,
        device && data.user ? { user: data.user.id, device } : undefined,
      ),
    )
    notifySlackOfNewUser(
      parsed.data.email,
      parsed.data.fullName,
      "email",
      normalizeSignupEligibilitySnapshot(signupEligibilitySnapshot),
      requestedOffer,
      ...(awaitingEnterpriseSetup ? [true] : []),
    ).catch(() => {})
    if (!emailSent)
      return {
        success: false,
        error: CONFIRMATION_NOT_SENT_MESSAGE,
        errorCode: "email_not_sent" as const,
      }
    return { success: true }
  } catch (err) {
    emitFingerprintObservation()
    console.error("Signup error:", err)
    return {
      success: false,
      error: "Error creating account. Please try again.",
    }
  }
}

export type ResendSignupConfirmationResult =
  | { success: true }
  | {
      success: false
      error: string
      errorCode:
        | "captcha_failed"
        | "resend_unavailable"
        | "already_confirmed"
        | "cooldown"
        | "email_not_sent"
      retryAfterSeconds?: number
    }

const RESEND_UNAVAILABLE: ResendSignupConfirmationResult = {
  success: false,
  error:
    "We can't resend from this page. Sign up again with the same email and password to get a new link.",
  errorCode: "resend_unavailable",
}

/**
 * Sends the signup confirmation again through the app email path. Only the
 * browser that just signed up holds the signed ticket, so the result cannot
 * reveal whether another account exists. The page sends the email it shows,
 * and a mismatch gets the no-ticket answer: a newer signup in another tab
 * replaced the ticket, and this page must not send that signup's email.
 */
export const resendSignupConfirmation = async (
  recaptchaToken?: string,
  shownEmail?: string,
): Promise<ResendSignupConfirmationResult> => {
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup_resend")
  if (!recaptcha.verified)
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed",
    }
  const ticket = await readSignupResendTicket()
  if (!ticket) return RESEND_UNAVAILABLE
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.auth.admin.getUserById(ticket.user)
    const user = data?.user
    if (error || !user?.email) {
      await clearSignupResendTicket()
      return RESEND_UNAVAILABLE
    }
    if (
      typeof shownEmail !== "string" ||
      shownEmail.trim().toLowerCase() !== user.email.toLowerCase()
    )
      return RESEND_UNAVAILABLE
    if (user.email_confirmed_at) {
      await clearSignupResendTicket()
      return {
        success: false,
        error: "Your email is already confirmed. Sign in to continue.",
        errorCode: "already_confirmed",
      }
    }
    // Auth records when it last issued this link type; the cooldown uses that
    // server-side time, so a new browser request cannot reset it.
    const lastSentAt = Date.parse(
      (ticket.type === "magiclink"
        ? user.recovery_sent_at
        : user.confirmation_sent_at) ?? "",
    )
    const waitSeconds = Number.isNaN(lastSentAt)
      ? 0
      : Math.ceil(RESEND_COOLDOWN_SECONDS - (Date.now() - lastSentAt) / 1000)
    if (waitSeconds > 0)
      return {
        success: false,
        error: `Please wait ${waitSeconds} seconds before you request another email.`,
        errorCode: "cooldown",
        retryAfterSeconds: Math.min(waitSeconds, RESEND_COOLDOWN_SECONDS),
      }
    // For an existing unconfirmed user, a signup link only issues a new
    // token; Auth ignores the password and keeps the original one.
    const { data: link, error: linkError } =
      await supabase.auth.admin.generateLink(
        ticket.type === "magiclink"
          ? {
              type: "magiclink",
              email: user.email,
              options: { redirectTo: ticket.redirect },
            }
          : {
              type: "signup",
              email: user.email,
              password: "",
              options: { redirectTo: ticket.redirect },
            },
      )
    const tokenHash = link?.properties?.hashed_token
    if (linkError || !tokenHash || link.user?.id !== ticket.user) {
      if (linkError?.message.includes("already registered")) {
        await clearSignupResendTicket()
        return {
          success: false,
          error: "Your email is already confirmed. Sign in to continue.",
          errorCode: "already_confirmed",
        }
      }
      console.error("Signup confirmation resend failed", {
        reason: linkError?.message ?? "missing_link",
      })
      return {
        success: false,
        error: CONFIRMATION_NOT_SENT_MESSAGE,
        errorCode: "email_not_sent",
      }
    }
    const sent = await sendConfirmationEmail(
      user.email,
      confirmationUrl(
        ticket.redirect,
        tokenHash,
        ticket.type,
        ticket.attempt,
        ticket.device
          ? { user: ticket.user, device: ticket.device }
          : undefined,
      ),
    )
    if (!sent)
      return {
        success: false,
        error: CONFIRMATION_NOT_SENT_MESSAGE,
        errorCode: "email_not_sent",
      }
    return { success: true }
  } catch (err) {
    console.error("Signup confirmation resend error:", err)
    return {
      success: false,
      error: CONFIRMATION_NOT_SENT_MESSAGE,
      errorCode: "email_not_sent",
    }
  }
}

export const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const baseDashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const dashboardUrl = `${baseDashboardUrl}?utm_source=email&utm_medium=welcome`
    await sendEmail({
      to: email,
      subject: "Welcome to Superserve!",
      react: WelcomeEmail({ name: name || "there", dashboardUrl }),
    })
  } catch (error) {
    console.error("Error sending welcome email:", error)
  }
}
