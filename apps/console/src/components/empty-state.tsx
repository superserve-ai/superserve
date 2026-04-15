import type { Icon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { CornerBrackets } from "./corner-brackets"

interface EmptyStateProps {
  icon: Icon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon: IconComponent,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="relative flex w-80 flex-col items-center px-10 py-10 text-center">
        <CornerBrackets size="lg" />

        <IconComponent className="size-10 text-foreground/60" weight="light" />
        <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
        {actionLabel && onAction && (
          <div className="mt-5">
            <Button size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
