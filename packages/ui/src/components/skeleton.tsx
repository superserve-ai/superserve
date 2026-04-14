"use client"

import { cn } from "../lib/utils"

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("bg-surface-hover motion-safe:animate-pulse", className)}
    />
  )
}

export { Skeleton }
