"use client"

import {
  CheckCircleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { cn, Spinner } from "@superserve/ui"
import { useEffect, useState } from "react"

import {
  formatElapsed,
  stepElapsedMs,
  type TenantRun,
  type TenantStep,
} from "@/lib/qm/events"

/** Ticks once a second so running steps show a live elapsed time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

interface ProvisioningStepsProps {
  run: TenantRun
  /** True while the tenant is still transitioning (drives the live clock). */
  live: boolean
  emptyMessage?: string
}

export function ProvisioningSteps({
  run,
  live,
  emptyMessage = "Waiting for the first step to start…",
}: ProvisioningStepsProps) {
  const { steps } = run
  const now = useNow(live && steps.some((s) => s.status === "started"))

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
        {live && <Spinner size="sm" />}
        {emptyMessage}
      </div>
    )
  }

  return (
    <ol className="flex flex-col" aria-label="Provisioning steps">
      {steps.map((step, index) => (
        <StepRow
          key={step.step}
          index={index + 1}
          step={step}
          elapsedMs={stepElapsedMs(step, now)}
        />
      ))}
    </ol>
  )
}

const STATUS_STYLE: Record<
  TenantStep["status"],
  { label: string; text: string }
> = {
  started: { label: "Running", text: "text-brand" },
  ok: { label: "Done", text: "text-foreground/80" },
  failed: { label: "Failed", text: "text-destructive" },
  skipped: { label: "Skipped", text: "text-muted" },
}

function StepIcon({ status }: { status: TenantStep["status"] }) {
  switch (status) {
    case "started":
      return <Spinner size="sm" className="text-brand" />
    case "ok":
      return <CheckCircleIcon className="size-4 text-brand" weight="light" />
    case "failed":
      return <XCircleIcon className="size-4 text-destructive" weight="light" />
    default:
      return <MinusCircleIcon className="size-4 text-muted" weight="light" />
  }
}

function StepRow({
  index,
  step,
  elapsedMs,
}: {
  index: number
  step: TenantStep
  elapsedMs: number | null
}) {
  const style = STATUS_STYLE[step.status]
  return (
    <li
      className={cn(
        "flex items-start gap-3 border-b border-dashed border-border px-4 py-3 last:border-b-0",
        step.status === "started" && "bg-brand/[0.03]",
        step.status === "failed" && "bg-destructive/[0.04]",
      )}
      data-status={step.status}
    >
      <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-muted tabular-nums">
        {String(index).padStart(2, "0")}
      </span>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <StepIcon status={step.status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <span className={cn("text-sm", style.text)}>{step.label}</span>
          <span className="font-mono text-xs text-muted uppercase tabular-nums">
            {style.label}
            {elapsedMs !== null && (
              <>
                <span className="mx-1.5">·</span>
                {formatElapsed(elapsedMs)}
              </>
            )}
          </span>
        </div>
        {step.message && (
          <p
            className={cn(
              "text-xs break-words",
              step.status === "failed" ? "text-destructive/80" : "text-muted",
            )}
          >
            {step.message}
          </p>
        )}
      </div>
    </li>
  )
}
