"use client"

import { MinusIcon, PlusIcon } from "@phosphor-icons/react"
import { cn } from "@superserve/ui"

// Controls shared by the template and sandbox dialogs for vCPU and memory.

export const focusRing =
  "focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"

export function formatMib(mib: number): string {
  return mib >= 1024 ? `${Number((mib / 1024).toFixed(2))} GB` : `${mib} MB`
}

export function formatVcpu(n: number): string {
  return `${n} vCPU`
}

function formatNum(n: number): string {
  return String(Number(n.toFixed(2)))
}

export function formatVcpuRange(min: number, max: number | undefined): string {
  return max == null ? formatVcpu(min) : `${min}–${formatVcpu(max)}`
}

export function formatMibRange(min: number, max: number | undefined): string {
  if (max == null) return formatMib(min)
  // Share the unit when both ends use it: "1–4 GB", not "1 GB–4 GB".
  return min >= 1024 && max >= 1024
    ? `${formatNum(min / 1024)}–${formatMib(max)}`
    : `${formatMib(min)}–${formatMib(max)}`
}

export interface StepperProps {
  label: string
  /** Visible label; without it, `label` names the control. */
  labelledBy?: string
  steps: readonly number[]
  value: number
  onChange: (value: number) => void
  format: (value: number) => string
}

export function Stepper({
  label,
  labelledBy,
  steps,
  value,
  onChange,
  format,
}: StepperProps) {
  const index = steps.indexOf(value)
  const last = steps.length - 1
  const go = (i: number) => onChange(steps[Math.max(0, Math.min(last, i))])
  const iconButton = cn(
    "flex size-9 cursor-pointer items-center justify-center text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30",
    focusRing,
  )
  return (
    <div className="flex shrink-0 items-center border border-dashed border-control">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={index <= 0}
        onClick={() => go(index - 1)}
        className={iconButton}
      >
        <MinusIcon className="size-3.5" weight="light" />
      </button>
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- steps are uneven, which a number input can't express
        role="spinbutton"
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-valuenow={value}
        aria-valuemin={steps[0]}
        aria-valuemax={steps[last]}
        aria-valuetext={format(value)}
        onKeyDown={(e) => {
          const next = {
            ArrowUp: index + 1,
            ArrowRight: index + 1,
            ArrowDown: index - 1,
            ArrowLeft: index - 1,
            Home: 0,
            End: last,
          }[e.key]
          if (next === undefined) return
          e.preventDefault()
          go(next)
        }}
        className={cn(
          "flex h-9 w-24 items-center justify-center border-x border-dashed border-control font-mono text-sm text-foreground tabular-nums",
          focusRing,
        )}
      >
        {format(value)}
      </div>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={index >= last}
        onClick={() => go(index + 1)}
        className={iconButton}
      >
        <PlusIcon className="size-3.5" weight="light" />
      </button>
    </div>
  )
}

// Label | control | plan max. On a phone the plan max moves under the label.
export const ROW_GRID =
  "grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[1fr_auto_4.5rem]"

// An indented row under a resource: label | control | right-hand note.
export function SubRow({
  label,
  note,
  children,
}: {
  label: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className={ROW_GRID}>
      <span className="border-l border-dashed border-control pl-3 text-sm text-foreground">
        {label}
      </span>
      {children}
      <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block">
        {note}
      </span>
    </div>
  )
}
