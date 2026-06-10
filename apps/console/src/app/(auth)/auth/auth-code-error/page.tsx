"use client"

import { WarningIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"

function AuthCodeErrorContent() {
  const searchParams = useSearchParams()
  const reason = searchParams.get("reason")
  const isSignupBlocked = reason === "signup_blocked"

  const heading = isSignupBlocked
    ? "Signup Not Available"
    : "Authentication Error"
  const message = isSignupBlocked
    ? "Signup is not available for this email address. Contact support@superserve.ai if you believe this is in error."
    : "Something went wrong during sign in. Please try again."
  const retryHref = isSignupBlocked ? "/auth/signup" : "/auth/signin"
  const retryLabel = isSignupBlocked ? "Back to Signup" : "Try Again"

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

        <div className="flex flex-col items-center">
          <WarningIcon className="mb-3 size-8 text-muted" weight="light" />
          <h1 className="text-center text-sm font-medium text-foreground">
            {heading}
          </h1>
          <p className="mt-2 text-center text-xs text-muted">{message}</p>
          <Button render={<Link href={retryHref} />} size="sm" className="mt-5">
            {retryLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AuthCodeErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <AuthCodeErrorContent />
    </Suspense>
  )
}
