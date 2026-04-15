import { forwardRef } from "react"
import { cn } from "../lib/utils"

type BadgeVariant = "default" | "success" | "warning" | "destructive" | "muted"

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted/10 text-muted",
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted",
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { className, variant = "default", dot = false, children, ...props },
    ref,
  ) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs uppercase font-mono",
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        {dot && (
          <span className={cn("h-1.5 w-1.5", dotColorClasses[variant])} />
        )}
        {children}
      </span>
    )
  },
)
Badge.displayName = "Badge"

export type { BadgeVariant }
export { Badge }
