import { cn } from "../lib/utils"

type SpinnerSize = "sm" | "md" | "lg"

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-5 border-2",
  lg: "size-8 border-2",
}

interface SpinnerProps {
  size?: SpinnerSize
  className?: string
}

function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-current border-t-transparent",
        sizeClasses[size],
        className,
      )}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading</span>
    </div>
  )
}

export { Spinner }
export type { SpinnerProps, SpinnerSize }
