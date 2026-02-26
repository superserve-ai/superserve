import type * as React from "react"
import { cn } from "../lib/utils"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  label?: string
  error?: string
  description?: string
}

function Textarea({
  className,
  label,
  error,
  description,
  id,
  ...props
}: TextareaProps) {
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
      <textarea
        id={id}
        className={cn(
          "min-h-[80px] w-full border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-border-focus focus:border-border-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus:ring-destructive/20",
          className,
        )}
        aria-invalid={!!error}
        {...props}
      />
      {description && !error && (
        <p className="text-xs text-muted">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export { Textarea }
