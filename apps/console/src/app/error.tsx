"use client"

import Link from "next/link"

import { ErrorState } from "@/components/error-state"
import {
  GOOGLE_SIGNUP_RECOVERY_URL,
  requiresGoogleSignupRecovery,
} from "@/lib/api/client"

// Catches errors that escape the route group boundaries, such as one thrown by
// a banner in the dashboard layout. Browser translation can make React throw
// while it updates the page; a full reload rebuilds the page and lets the
// server send a team that needs a plan to the plan picker.
export default function RootError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {/* The dashboard layout can throw this one too; keep its way out. */}
      {requiresGoogleSignupRecovery(error) ? (
        <Link
          href={GOOGLE_SIGNUP_RECOVERY_URL}
          className="text-brand underline"
        >
          Complete signup with Google
        </Link>
      ) : (
        <ErrorState
          title="This page couldn't load"
          message="Something went wrong while the page updated. Reload to try again."
          onRetry={() => window.location.reload()}
        />
      )}
    </div>
  )
}
