"use client"

import Link from "next/link"

import { ErrorState } from "@/components/error-state"
import {
  GOOGLE_SIGNUP_RECOVERY_URL,
  requiresGoogleSignupRecovery,
} from "@/lib/api/client"

export default function ApiKeysError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center">
      {requiresGoogleSignupRecovery(error) ? (
        <Link
          href={GOOGLE_SIGNUP_RECOVERY_URL}
          className="text-brand underline"
        >
          Complete signup with Google
        </Link>
      ) : (
        <ErrorState
          message={error.message || "Something went wrong"}
          onRetry={reset}
        />
      )}
    </div>
  )
}
