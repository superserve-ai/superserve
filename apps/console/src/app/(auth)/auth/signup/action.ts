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
  isGoogleUser,
  issueGoogleSignupProof,
} from "@/lib/auth/google-signup-proof"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import { passwordTooLongError } from "@/lib/auth/password-rule"
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
import { createServerClient } from "@/lib/supabase/server"
import { ycReturnPath } from "@/lib/yc/return-path"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .superRefine((password, ctx) => {
      // Auth's bcrypt hash reads only 72 bytes; the form checks this too,
      // but a direct call to this action skips the form.
      const message = passwordTooLongError(password)
      if (message) ctx.addIssue({ code: "custom", message })
    }),
  fullName: z.string().min(1, "Name is required.").max(200),
})

/** True once for the recovery mark this browser's failed callback set. */
export async function claimGoogleRecoveryContinuation(
  reason: string,
): Promise<boolean> {
  return claimGoogleSignupRecovery(reason)
}

/**
 * The Google account this browser just signed in with, so the recovery page
 * can send the user back to that same account without Google's account
 * chooser. It is only a hint: the callback still requires the signup proof.
 */
export async function googleRecoveryAccount(): Promise<string | undefined> {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.email && isGoogleUser(user) ? user.email : undefined
  } catch {
    return undefined
  }
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

// These actions take client input, and the label goes into analytics, so only
// the two known pages pass.
function knownEntryPoint(value: unknown): "signin" | "signup" | undefined {
  return value === "signin" || value === "signup" ? value : undefined
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
  entryPoint?: "signin" | "signup",
) {
  try {
    after(() =>
      observeCloudflareSignup({
        signupAttemptId,
        signupMethod,
        entryPoint: knownEntryPoint(entryPoint),
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

// verifyRecaptcha also passes when the provider is down. Signup creates an
// account, so it must not run without a real verdict. A missing or invalid
// token is refused; a broken setup on our side gets its own message so the
// visitor does not retry a check they cannot pass.
function strictRecaptchaBlock(
  recaptcha: Awaited<ReturnType<typeof verifyRecaptcha>>,
) {
  if (
    !recaptcha.verified &&
    recaptcha.providerOutcome === "configuration_error"
  ) {
    return {
      reason: recaptcha.reason,
      response: {
        error: "Sign-up is not available right now. Please try again later.",
        errorCode: "captcha_unavailable" as const,
      },
    }
  }
  if (!recaptcha.verified) {
    return {
      reason: recaptcha.reason,
      response: {
        error: "We couldn't verify you're human. Please try again.",
        errorCode: "captcha_failed" as const,
      },
    }
  }
  if (recaptcha.providerOutcome === "unavailable") {
    return {
      reason: "provider_unavailable",
      response: {
        error: "We couldn't reach our bot-check. Please try again in a minute.",
        errorCode: "captcha_unavailable" as const,
      },
    }
  }
  return undefined
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
  entryPoint?: "signin" | "signup",
) {
  if (!eventId) return
  try {
    after(() =>
      observeFingerprintSignup({
        eventId,
        signupMethod,
        ...(knownEntryPoint(entryPoint)
          ? { entryPoint: knownEntryPoint(entryPoint) }
          : {}),
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

/**
 * Sends a PostHog event once the response is out. `trackEvent` waits for a
 * PostHog flush, and the sign-in page waits for the Google sign-up proof
 * within a deadline, so the flush must not come before the answer.
 */
function trackEventAfterResponse(...event: Parameters<typeof trackEvent>) {
  try {
    after(async () => {
      try {
        await trackEvent(...event)
      } catch {
        // Analytics only.
      }
    })
  } catch {
    // Analytics only: `after` throws outside a request scope.
  }
}

export const beginGoogleSignup = async (
  recaptchaToken?: string,
  turnstileToken?: string,
  captureResult?: SignupFingerprintResult,
  browserDiagnostics?: BrowserFingerprintDiagnostics,
  // Which page ran the check. Only labels events; it grants nothing.
  entryPoint?: "signin" | "signup",
): Promise<
  | { success: true; signupAttemptId: string }
  | {
      success: false
      error: string
      errorCode: "captcha_failed" | "captcha_unavailable" | "proof_unavailable"
    }
> => {
  const capture =
    captureResult && "attemptId" in captureResult ? captureResult : undefined
  const signupAttemptId = crypto.randomUUID()
  const entry_point = entryPoint === "signin" ? "signin" : "signup"
  await beginSignupEvidenceAttempt(signupAttemptId)
  const clientContext = await readCloudflareClientContext()
  const fingerprintEventId =
    capture?.eventId ?? (await readFingerprintSignupEventId())
  const diagnostic = fingerprintDiagnostics({
    signupAttemptId,
    signupMethod: "google",
    captureAttemptId: capture?.attemptId,
    eventId: fingerprintEventId,
    entryPoint: entry_point,
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
    entry_point,
  )
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signup_google")
  const recaptchaBlock = strictRecaptchaBlock(recaptcha)
  trackEventAfterResponse(
    AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED,
    signupAttemptId,
    {
      provider: "recaptcha",
      signup_attempt_id: signupAttemptId,
      signup_method: "google",
      entry_point,
      verified: recaptcha.verified,
      provider_outcome: recaptcha.providerOutcome,
      reason: "reason" in recaptcha ? recaptcha.reason : null,
      block_reason: recaptchaBlock?.reason ?? null,
      score: recaptcha.score,
      recaptcha_assessment_id: recaptcha.assessmentId ?? null,
      recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
      observed_at: new Date().toISOString(),
    },
  )
  if (recaptchaBlock) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    await scheduleFingerprintObservation(
      fingerprintEventId,
      "google",
      null,
      signupAttemptId,
      entry_point,
    )
    trackEventAfterResponse(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason: recaptchaBlock.reason,
        stage: "captcha_verification",
        entry_point,
      },
    )
    console.warn("Google signup blocked by reCAPTCHA", {
      reason: recaptchaBlock.reason,
    })
    return { success: false, ...recaptchaBlock.response }
  }

  try {
    let verified = false
    let attestationFailed = false
    const visitor = fingerprintEventId
      ? await resolveFingerprintSignup({
          eventId: fingerprintEventId,
          signupMethod: "google",
          entryPoint: entry_point,
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
    trackEventAfterResponse(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_VERIFIED,
      signupAttemptId,
      {
        stage: "captcha_verification",
        entry_point,
      },
    )
    console.info("Google signup CAPTCHA verified; pre-auth proof issued")
    return { success: true, signupAttemptId }
  } catch (error) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    trackEventAfterResponse(
      AUTH_EVENTS.GOOGLE_SIGNUP_CAPTCHA_FAILED,
      signupAttemptId,
      {
        reason:
          error instanceof Error ? error.message : "proof_issuance_failed",
        stage: "proof_issuance",
        entry_point,
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
  const recaptchaBlock = strictRecaptchaBlock(recaptcha)
  await trackEvent(AUTH_EVENTS.SIGNUP_RECAPTCHA_OBSERVED, signupAttemptId, {
    provider: "recaptcha",
    signup_attempt_id: signupAttemptId,
    signup_method: "email",
    verified: recaptcha.verified,
    provider_outcome: recaptcha.providerOutcome,
    reason: "reason" in recaptcha ? recaptcha.reason : null,
    block_reason: recaptchaBlock?.reason ?? null,
    score: recaptcha.score,
    recaptcha_assessment_id: recaptcha.assessmentId ?? null,
    recaptcha_risk_reasons: recaptcha.riskReasons ?? [],
    observed_at: new Date().toISOString(),
  })
  if (recaptchaBlock) {
    if (fingerprintEventId)
      await consumeFingerprintSignupEventId(fingerprintEventId)
    emitFingerprintObservation()
    console.warn("Signup blocked by reCAPTCHA", {
      email: parsed.data.email,
      reason: recaptchaBlock.reason,
    })
    return { success: false as const, ...recaptchaBlock.response }
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
