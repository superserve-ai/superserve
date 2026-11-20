import { Button } from "@superserve/ui"

export function UsageUnavailable({
  onRetry,
  timedOut = false,
}: {
  onRetry: () => void
  timedOut?: boolean
}) {
  return (
    <section
      aria-label="Usage unavailable"
      className="mx-auto w-full max-w-4xl space-y-3 border border-dashed border-border bg-surface/40 p-5"
    >
      <h2 className="text-sm font-semibold text-foreground">
        Usage Unavailable
      </h2>
      <p className="text-sm text-muted">
        {timedOut
          ? "The usage request timed out. Retry to check for updated usage and charges."
          : "Storage measurements are temporarily unavailable. Usage totals and charges cannot be shown yet."}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry usage
      </Button>
    </section>
  )
}
