import type * as React from "react"
import { cn } from "../lib/utils"

interface InputProps extends React.ComponentProps<"input"> {
  label?: string
  error?: string
  description?: string
  suffix?: React.ReactNode
}

function Input({
  className,
  label,
  error,
  description,
  suffix,
  id,
  ...props
}: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          className={cn(
            "h-9 w-full border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus:ring-destructive/20",
            suffix && "pr-10",
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {suffix}
          </div>
        )}
      </div>
      {description && !error && (
        <p className="text-xs text-muted">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export { Input }
