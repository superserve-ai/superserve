"use client"

import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { usePostHog } from "posthog-js/react"
import { Suspense, useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { Spinner } from "@/components/icons"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { sendPasswordResetEmail } from "./action"

function ForgotPasswordContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [emailSent, setEmailSent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const posthog = usePostHog()

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    if (!email) {
      setErrors({ email: "Email is required." })
      return
    }
    setIsLoading(true)
    try {
      await sendPasswordResetEmail(email)
      posthog.capture(AUTH_EVENTS.PASSWORD_RESET_REQUESTED)
      setEmailSent(true)
    } catch {
      setErrors({ form: "Error sending reset email. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>

        {emailSent ? (
          <>
            <h1 className="text-center text-sm font-medium text-foreground">
              Check Your Email
            </h1>
            <p className="mt-2 text-center text-xs leading-relaxed text-muted">
              We&apos;ve sent a password reset link to{" "}
              <strong className="text-foreground">{email}</strong>. Check your
              inbox and click the link to reset your password.
            </p>
            <p className="mt-5 text-center text-xs text-muted">
              <Link
                href="/auth/signin"
                className="font-medium text-foreground hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-6 text-center text-sm font-medium text-foreground">
              Reset your password
            </h1>

            <form onSubmit={handleResetPassword} className="space-y-3">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />
              {errors.form && (
                <p className="text-xs text-destructive">{errors.form}</p>
              )}
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? <Spinner /> : null}
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted">
              <Link
                href="/auth/signin"
                className="font-medium text-foreground hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  )
}
