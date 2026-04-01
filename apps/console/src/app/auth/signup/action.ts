"use server"

import { generateSignupLink } from "@/lib/auth"
import { z } from "zod"
import { notifySlackOfNewUser } from "@/app/auth/signin/action"
import { sendEmail } from "@/lib/email/send"
import { ConfirmationEmail } from "@/lib/email/templates/confirmation"
import { WelcomeEmail } from "@/lib/email/templates/welcome"

const signUpSchema = z.object({
  email: z.string().email("Invalid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(1, "Name is required.").max(200),
})

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
) => {
  const parsed = signUpSchema.safeParse({ email, password, fullName })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  try {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"
    const redirectTo = `${appUrl}/auth/callback`

    const { tokenHash, error: linkError } = await generateSignupLink(
      parsed.data.email,
      parsed.data.password,
      parsed.data.fullName,
      redirectTo,
    )

    if (linkError || !tokenHash) {
      if (linkError?.includes("already registered")) {
        return {
          success: false,
          error: "An account with this email already exists.",
        }
      }
      return { success: false, error: linkError || "Failed to generate confirmation link." }
    }

    const confirmationUrl = `${redirectTo}?token_hash=${tokenHash}&type=signup`

    await sendEmail({
      to: parsed.data.email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({ confirmationUrl }),
    })

    notifySlackOfNewUser(
      parsed.data.email,
      parsed.data.fullName,
      "email",
    ).catch(() => {})

    return { success: true }
  } catch (err) {
    console.error("Signup error:", err)
    return {
      success: false,
      error: "Error creating account. Please try again.",
    }
  }
}

export const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const dashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai"

    await sendEmail({
      to: email,
      subject: "Welcome to Superserve!",
      react: WelcomeEmail({ name: name || "there", dashboardUrl }),
    })
  } catch (error) {
    console.error("Error sending welcome email:", error)
  }
}
