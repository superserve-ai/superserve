import { cn } from "@superserve/ui"

interface CornerBracketsProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-3 w-3",
}

export function CornerBrackets({
  size = "md",
  className = "border-foreground/50",
}: CornerBracketsProps) {
  const s = SIZES[size]
  return (
    <>
      <span
        className={cn("absolute top-0 left-0 border-t border-l", s, className)}
      />
      <span
        className={cn("absolute top-0 right-0 border-t border-r", s, className)}
      />
      <span
        className={cn(
          "absolute bottom-0 left-0 border-b border-l",
          s,
          className,
        )}
      />
      <span
        className={cn(
          "absolute bottom-0 right-0 border-b border-r",
          s,
          className,
        )}
      />
    </>
  )
}
