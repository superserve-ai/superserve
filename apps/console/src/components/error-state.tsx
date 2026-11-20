"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useEffect } from "react"

import { ApiError } from "@/lib/api/client"

import { CornerBrackets } from "./corner-brackets"

const DEFAULT_MESSAGE =
  "An error occurred while loading data. Please try again."
const loggedErrors = new WeakSet<object>()

export function errorStateMessage(error: unknown, notFoundMessage: string) {
  return error == null || (error instanceof ApiError && error.status === 404)
    ? notFoundMessage
    : DEFAULT_MESSAGE
}

interface ErrorStateProps {
  title?: string
  message?: string
  /** Logged for diagnostics, never shown. */
  error?: unknown
  suggestion?: string
  onRetry?: () => void
}

export function ErrorState({
  title = "Something went wrong",
  message = DEFAULT_MESSAGE,
  error,
  suggestion,
  onRetry,
}: ErrorStateProps) {
  useEffect(() => {
    if (error == null) return

    if (typeof error === "object") {
      if (loggedErrors.has(error)) return
      loggedErrors.add(error)
    }

    const digest =
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string"
        ? error.digest
        : undefined

    console.error(title, { error, digest })
  }, [error, title])

  return (
    <div className="flex min-h-full flex-1 items-center justify-center py-16">
      <div className="relative flex w-80 flex-col items-center px-10 py-14 text-center">
        <CornerBrackets size="lg" />

        <WarningCircleIcon
          className="size-10 text-destructive/60"
          weight="light"
        />
        <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{message}</p>
        {suggestion && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted/70">
            {suggestion}
          </p>
        )}
        {onRetry && (
          <div className="mt-5">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
