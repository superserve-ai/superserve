import { forwardRef } from "react"

import { cn } from "../lib/utils"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-[80px] w-full border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted",
          "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-30",
          error && "border-destructive focus:ring-destructive/20",
          className,
        )}
        aria-invalid={!!error}
        {...props}
      />
    )
  },
)
Textarea.displayName = "Textarea"

export type { TextareaProps }
export { Textarea }
