"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { CornerBrackets } from "./corner-brackets"

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = "Something went wrong",
  message = "An error occurred while loading data. Please try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="relative flex w-80 flex-col items-center px-10 py-14 text-center">
        <CornerBrackets size="lg" />

        <WarningCircleIcon
          className="size-10 text-destructive/60"
          weight="light"
        />
        <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{message}</p>
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
