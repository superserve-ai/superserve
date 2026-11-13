"use server"

import { after } from "next/server"
import * as z from "zod"

import {
  isSignupReviewBlocked,
  signupReviewStatus,
} from "@/lib/auth/signup-review"
import { isPlanPickerPath } from "@/lib/billing/signup-checkout-paths"
import { sendEmail } from "@/lib/email/send"
import { SignInLinkEmail } from "@/lib/email/templates/sign-in-link"
import { trackEvent } from "@/lib/posthog/actions"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { verifyRecaptcha } from "@/lib/recaptcha/verify"
import { createAdminClient } from "@/lib/supabase/admin"

const linkSchema = z.object({
  email: z.string().email(),
})

function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  if (
    raw === "/" ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    // Other /auth/ pages, such as reset-password, are not sign-in landings.
    (raw.startsWith("/auth/") && !isPlanPickerPath(raw)) ||
    /[\\\u0000- \u007f]/.test(raw)
  ) {
    return null
  }
  return raw
}

async function trackLinkFailure(reason: string, userId?: string) {
  await trackEvent(
    AUTH_EVENTS.SIGN_IN_LINK_FAILED,
    userId ?? crypto.randomUUID(),
    { method: "email_link", reason },
  )
}

// Runs after the response is sent, so the response and its timing are the
// same whether or not the address belongs to an eligible account.
async function deliverSignInLink(email: string, next: string | null) {
  try {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const callbackUrl = new URL("/auth/callback", appUrl)

    // A recovery token, not signInWithOtp: the admin API never creates a user
    // and never re-sends a signup confirmation, and the callback verifies the
    // token as a magic link, which signs in without the reset-password step.
    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: callbackUrl.toString() },
    })

    if (error || !data?.properties?.hashed_token || !data.user) {
      const noAccount =
        error?.status === 404 || error?.code === "user_not_found"
      if (!noAccount) {
        console.error("Error generating sign-in link:", error?.message)
      }
      await trackLinkFailure(noAccount ? "no_account" : "generate_failed")
      return
    }

    // Verifying the link would confirm an unconfirmed address, so only
    // confirmed accounts that are not waiting for signup review get one.
    // Staff approval already emails an unconfirmed account a confirming magic
    // link, and the token generated above replaced it, so approved accounts
    // get this link in its place.
    const user = data.user
    const banned =
      !!user.banned_until && new Date(user.banned_until).getTime() > Date.now()
    const confirmedOrApproved =
      !!user.email_confirmed_at || signupReviewStatus(user) === "approved"
    if (!confirmedOrApproved || banned || isSignupReviewBlocked(user)) {
      await trackLinkFailure("not_eligible", user.id)
      return
    }

    callbackUrl.searchParams.set("token_hash", data.properties.hashed_token)
    callbackUrl.searchParams.set("type", "magiclink")
    callbackUrl.searchParams.set("sign_in_recovery", "email_link")
    if (next) callbackUrl.searchParams.set("next", next)
    callbackUrl.searchParams.set("utm_source", "email")
    callbackUrl.searchParams.set("utm_medium", "sign_in_link")

    const to = user.email || email
    const sent = await sendEmail({
      to,
      subject: "Your Superserve sign-in link",
      react: SignInLinkEmail({ email: to, signInUrl: callbackUrl.toString() }),
    })
    if (!sent.success) {
      await trackLinkFailure("send_failed", user.id)
      return
    }

    await trackEvent(AUTH_EVENTS.SIGN_IN_LINK_SENT, user.id, {
      method: "email_link",
    })
  } catch (error) {
    console.error("Error sending sign-in link:", error)
  }
}

export const sendSignInLink = async (
  // Server actions expose an RPC endpoint with no runtime type enforcement.
  email: unknown,
  recaptchaToken: unknown,
  next?: unknown,
): Promise<
  | { success: true }
  | { success: false; errorCode: "captcha_failed" }
  | { success: false; errorCode: "captcha_unavailable"; error: string }
> => {
  const recaptcha = await verifyRecaptcha(recaptchaToken, "signin_link")
  // A broken setup on our side gets its own message, so the visitor does not
  // retry a check that cannot pass.
  if (
    !recaptcha.verified &&
    recaptcha.providerOutcome === "configuration_error"
  ) {
    return {
      success: false,
      errorCode: "captcha_unavailable",
      error:
        "Email sign-in links are not available right now. Please try again later.",
    }
  }
  if (!recaptcha.verified) {
    return { success: false, errorCode: "captcha_failed" }
  }
  // verifyRecaptcha also passes when the provider is down. This action has no
  // other throttle, so it must not send email without a real verdict.
  if (recaptcha.providerOutcome === "unavailable") {
    return {
      success: false,
      errorCode: "captcha_unavailable",
      error: "We couldn't reach our bot-check. Please try again in a minute.",
    }
  }

  const parsed = linkSchema.safeParse({ email })
  if (parsed.success) {
    const address = parsed.data.email
    after(() => deliverSignInLink(address, safeNext(next)))
  }

  // Always the same result, to prevent email enumeration.
  return { success: true }
}
