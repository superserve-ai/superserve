"use client"

import { motion } from "motion/react"
import { cn } from "../lib/utils"

type ProgressVariant = "default" | "success" | "warning" | "destructive"

const barClasses: Record<ProgressVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  variant?: ProgressVariant
}

function Progress({
  className,
  value,
  max = 100,
  variant = "default",
  ...props
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-1.5 w-full overflow-hidden bg-surface-hover", className)}
      {...props}
    >
      <motion.div
        className={cn("h-full", barClasses[variant])}
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  )
}

export { Progress }
export type { ProgressVariant }
