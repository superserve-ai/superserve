"use server"

import { headers } from "next/headers"
import * as z from "zod"

import { inviteReturnPath } from "@/lib/auth/invite-return-path"
import { type AuthRateLimit, consumeAuthRateLimit } from "@/lib/auth/rate-limit"
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

// Vercel overwrites x-real-ip and x-forwarded-for with the connecting client's
// IP. Other client IP headers, such as cf-connecting-ip, pass through as sent,
// so a caller could rotate them to get a fresh bucket.
async function readClientIp() {
  try {
    const requestHeaders = await headers()
    return (
      requestHeaders.get("x-real-ip")?.trim() ||
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      undefined
    )
  } catch {
    return undefined
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
  // Silent, so the answer is the same whether or not the address has an
  // account.
  if (
    !(await consumeAuthRateLimit(
      RESET_EMAIL_LIMIT,
      parsed.data.email.toLowerCase(),
    ))
  ) {
    return { success: true }
  }

  try {
    const supabase = createAdminClient()

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const invite = inviteReturnPath(typeof next === "string" ? next : undefined)
    const redirectTo = `${appUrl}/auth/callback?next=/auth/reset-password${invite ? `&${new URLSearchParams({ invite })}` : ""}`

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: { redirectTo },
    })

    if (error || !data?.properties?.hashed_token) {
      console.error("Error generating reset link:", error?.message)
      return { success: true } // Always return success to prevent email enumeration
    }

    // Using a recovery link confirms the address, so accounts awaiting signup
    // review silently get nothing; accounts that predate review keep recovery.
    if (isSignupReviewBlocked(data.user)) {
      return { success: true } // Always return success to prevent email enumeration
    }

    const resetUrlObj = new URL(redirectTo)
    resetUrlObj.searchParams.set("token_hash", data.properties.hashed_token)
    resetUrlObj.searchParams.set("type", "recovery")
    resetUrlObj.searchParams.set("utm_source", "email")
    resetUrlObj.searchParams.set("utm_medium", "password_reset")

    await sendEmail({
      to: parsed.data.email,
      subject: "Reset your Superserve password",
      react: PasswordResetEmail({
        email: parsed.data.email,
        resetUrl: resetUrlObj.toString(),
      }),
    })

    return { success: true }
  } catch (error) {
    console.error("Error sending password reset email:", error)
    return { success: true } // Always return success to prevent email enumeration
  }
}
