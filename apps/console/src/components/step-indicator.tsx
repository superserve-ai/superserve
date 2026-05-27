import { CheckIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"

interface StepIndicatorProps {
  step: number
  label: string
  completed: boolean
  active: boolean
  onClick: () => void
}

export function StepIndicator({
  step,
  label,
  completed,
  active,
  onClick,
}: StepIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={cn(
        "flex w-full items-center gap-4 px-4 py-4 text-left transition-colors",
        active
          ? "border border-dashed border-border bg-surface"
          : "border border-dashed border-transparent hover:bg-surface-hover",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
          completed
            ? "border-primary bg-primary text-brand-ink"
            : active
              ? "border-primary text-primary"
              : "border-border text-muted",
        )}
      >
        {completed ? <CheckIcon className="h-3.5 w-3.5" weight="bold" /> : step}
      </div>
      <span
        className={cn(
          "text-sm font-medium",
          completed || active ? "text-foreground" : "text-muted",
        )}
      >
        {label}
      </span>
    </button>
  )
}
