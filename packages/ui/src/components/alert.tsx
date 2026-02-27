import { AlertTriangle, Check, Info } from "lucide-react"
import { cn } from "../lib/utils"

type AlertVariant = "default" | "success" | "warning" | "destructive"

const variantConfig: Record<
  AlertVariant,
  { icon: typeof Info; containerClass: string; iconClass: string }
> = {
  default: {
    icon: Info,
    containerClass: "border-border bg-surface",
    iconClass: "text-primary",
  },
  success: {
    icon: Check,
    containerClass: "border-success/20 bg-success/5",
    iconClass: "text-success",
  },
  warning: {
    icon: AlertTriangle,
    containerClass: "border-warning/20 bg-warning/5",
    iconClass: "text-warning",
  },
  destructive: {
    icon: AlertTriangle,
    containerClass: "border-destructive/20 bg-destructive/5",
    iconClass: "text-destructive",
  },
}

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  title?: string
}

function Alert({
  className,
  variant = "default",
  title,
  children,
  ...props
}: AlertProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 border border-dashed p-4",
        config.containerClass,
        className,
      )}
      {...props}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.iconClass)} />
      <div className="flex-1 min-w-0">
        {title && (
          <p className="text-sm font-medium text-foreground">{title}</p>
        )}
        {children && (
          <div className={cn("text-sm text-muted", title && "mt-1")}>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

export { Alert }
export type { AlertVariant }
