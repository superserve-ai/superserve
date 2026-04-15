"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "../lib/utils"

type ProgressVariant = "default" | "success" | "warning" | "destructive"

const barClasses: Record<ProgressVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

interface ProgressProps {
  value: number
  max?: number
  variant?: ProgressVariant
  className?: string
}

function Progress({
  value,
  max = 100,
  variant = "default",
  className,
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cn("w-full", className)}
    >
      <ProgressPrimitive.Track className="h-1.5 w-full overflow-hidden bg-surface-hover">
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full transition-all duration-500 ease-out",
            barClasses[variant],
          )}
          style={{ width: `${percentage}%` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export type { ProgressProps, ProgressVariant }
export { Progress }
