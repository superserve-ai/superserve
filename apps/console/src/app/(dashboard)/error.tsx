"use client"

import { ErrorState } from "@/components/error-state"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <ErrorState
        message={error.message || "Something went wrong"}
        onRetry={reset}
      />
    </div>
  )
}
