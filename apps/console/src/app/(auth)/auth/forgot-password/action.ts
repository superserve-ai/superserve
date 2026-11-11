"use server"

import { after } from "next/server"
import * as z from "zod"

import { readClientIp } from "@/lib/auth/client-ip"
import { findAuthUserByEmail } from "@/lib/auth/find-auth-user"
import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import { type AuthRateLimit, consumeAuthRateLimit } from "@/lib/auth/rate-limit"
import { reserveRecoveryEmail } from "@/lib/auth/recovery-email-limits"
import { isSignupReviewBlocked } from "@/lib/auth/signup-review"
import { sendEmail } from "@/lib/email/send"
import { PasswordResetEmail } from "@/lib/email/templates/password-reset"
import { verifyRecaptcha } from "@/lib/recaptcha/verify"
import { createAdminClient } from "@/lib/supabase/admin"

const resetSchema = z.object({
  email: z.string().email(),
})

// Per client IP. Generous enough for a shared office network.
const RESET_IP_LIMIT: AuthRateLimit = {
  bucket: "password_reset_ip",
  max: 10,
  windowSeconds: 15 * 60,
}
// Per address. Stops one inbox from being flooded with reset emails.
const RESET_EMAIL_LIMIT: AuthRateLimit = {
  bucket: "password_reset_email",
  max: 3,
  windowSeconds: 15 * 60,
}

// Runs after the response is sent, so the response and its timing are the
// same whether or not the address has an account.
async function deliverPasswordReset(
  email: string,
  clientIp: string | undefined,
  invite: string | null,
) {
  try {
    // Using a recovery link confirms the address, so accounts awaiting signup
    // review get nothing; accounts that predate review keep recovery.
    const user = await findAuthUserByEmail(email)
    if (!user || isSignupReviewBlocked(user)) return

    // A new token replaces the one in any email already sent, so take from
    // the email limits before creating the token, never after.
    if (
      (await reserveRecoveryEmail({
        userId: user.id,
        email,
        clientIp,
        addressLimit: RESET_EMAIL_LIMIT,
      })) !== "reserved"
    ) {
      return
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const redirectTo = `${appUrl}/auth/callback?next=/auth/reset-password${invite ? `&${new URLSearchParams({ invite })}` : ""}`

    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    })

    if (error || !data?.properties?.hashed_token) {
      console.error("Error generating reset link:", error?.message)
      return
    }

    const resetUrlObj = new URL(redirectTo)
    resetUrlObj.searchParams.set("token_hash", data.properties.hashed_token)
    resetUrlObj.searchParams.set("type", "recovery")
    resetUrlObj.searchParams.set("utm_source", "email")
    resetUrlObj.searchParams.set("utm_medium", "password_reset")

    await sendEmail({
      to: email,
      subject: "Reset your Superserve password",
      react: PasswordResetEmail({
        email,
        resetUrl: resetUrlObj.toString(),
      }),
    })
  } catch (error) {
    console.error("Error sending password reset email:", error)
  }
}

export const sendPasswordResetEmail = async (
  // Server actions expose an RPC endpoint with no runtime type enforcement.
  email: unknown,
  recaptchaToken?: unknown,
  next?: unknown,
): Promise<
  | { success: true }
  | {
      success: false
      error: string
      errorCode: "captcha_failed" | "captcha_unavailable" | "rate_limited"
    }
> => {
  const recaptcha = await verifyRecaptcha(recaptchaToken, "password_reset")
  if (!recaptcha.verified) {
    return {
      success: false,
      error: "We couldn't verify you're human. Please try again.",
      errorCode: "captcha_failed",
    }
  }
  // verifyRecaptcha also passes when the provider is down. This action sends
  // email, so it must not run without a real verdict.
  if (recaptcha.providerOutcome === "unavailable") {
    return {
      success: false,
      error: "We couldn't reach our bot-check. Please try again in a minute.",
      errorCode: "captcha_unavailable",
    }
  }

  const parsed = resetSchema.safeParse({ email })
  if (!parsed.success) {
    return { success: true } // Always return success to prevent email enumeration
  }

  const clientIp = await readClientIp()
  if (clientIp && !(await consumeAuthRateLimit(RESET_IP_LIMIT, clientIp))) {
    return {
      success: false,
      error: "Too many reset requests. Try again in a few minutes.",
      errorCode: "rate_limited",
    }
  }
  const address = parsed.data.email
  const invite = inviteReturnPath(typeof next === "string" ? next : undefined)
  after(() => deliverPasswordReset(address, clientIp, invite))

  // Always the same result, to prevent email enumeration.
  return { success: true }
}
