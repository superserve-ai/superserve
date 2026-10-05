"use server"

import crypto from "node:crypto"

import { cookies } from "next/headers"
import { headers } from "next/headers"
import { after } from "next/server"
import * as z from "zod"

import { createPromotionSignupAttempt } from "@/lib/api/promotion-device-evidence"
import { publishOriginalSignupEvidence } from "@/lib/api/promotion-publication"
import { isGenericAuthSignupFailure } from "@/lib/auth/errors"
import { issueGoogleSignupProof } from "@/lib/auth/google-signup-proof"
import {
  beginSignupEvidenceAttempt,
  isSupersededSignupEvidenceAttempt,
  saveSignupEvidence,
} from "@/lib/auth/signup-evidence"
import {
  evaluateSignupRestriction,
  SignupRestrictedError,
  SIGNUP_RESTRICTED_MESSAGE,
} from "@/lib/auth/signup-restrictions"
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

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
})

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

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
  recaptchaToken?: string,
  turnstileToken?: string,
  captureResult?: SignupFingerprintResult,
) => {
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
          ).catch(() => {})
          return { success: false, error: SIGNUP_RESTRICTED_MESSAGE }
        }
        throw error
      }
    }

    const supabase = createAdminClient()
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const redirectTo = `${appUrl}/auth/callback`
    const signupStartedAt = Date.now()
    const { data, error } = await supabase.auth.admin.generateLink({
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
    })
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

    const confirmation = new URL(redirectTo)
    confirmation.searchParams.set("token_hash", tokenHash)
    confirmation.searchParams.set("type", "signup")
    confirmation.searchParams.set("signup_attempt_id", signupAttemptId)
    confirmation.searchParams.set("utm_source", "email")
    confirmation.searchParams.set("utm_medium", "signup_confirmation")
    if (originalSignup && deviceVerified && capture) {
      const proof = signSignupDeviceBinding(data.user.id, capture.attemptId)
      if (proof) {
        confirmation.searchParams.set("device_attempt_id", capture.attemptId)
        confirmation.searchParams.set("device_bind_proof", proof)
      }
    }
    const confirmationUrl = confirmation.toString()
    await sendEmail({
      to: parsed.data.email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({ confirmationUrl }),
    })
    notifySlackOfNewUser(
      parsed.data.email,
      parsed.data.fullName,
      "email",
      normalizeSignupEligibilitySnapshot(signupEligibilitySnapshot),
    ).catch(() => {})
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
