import { cn } from "../lib/utils"

function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center gap-1 border border-dashed border-border bg-surface-hover px-1.5 font-mono text-[10px] text-muted",
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
