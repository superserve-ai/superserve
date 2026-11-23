"use client"

import {
  formatMib,
  formatMibRange,
  formatVcpu,
  ROW_GRID,
  Stepper,
} from "@/components/size-controls"
import type { TemplateResponse } from "@/lib/api/types"

export type SizeRange = Pick<
  TemplateResponse,
  "vcpu" | "vcpu_max" | "memory_mib" | "memory_max_mib"
>

export function hasCpuRange(t: SizeRange | undefined): t is SizeRange & {
  vcpu_max: number
} {
  return t?.vcpu_max != null && t.vcpu_max > t.vcpu
}

export function hasMemoryRange(t: SizeRange | undefined): t is SizeRange & {
  memory_max_mib: number
} {
  return t?.memory_max_mib != null && t.memory_max_mib > t.memory_mib
}

const MEMORY_STEP_MIB = 256

// 256 MiB steps from the minimum plus the maximum itself; every value stays a
// whole number of 2 MiB steps from the minimum, as the API requires.
export function memorySteps(min: number, max: number, keep?: number): number[] {
  const steps: number[] = []
  for (let v = min; v < max; v += MEMORY_STEP_MIB) steps.push(v)
  steps.push(max)
  // The source's own size stays selectable, so opening doesn't change it.
  if (keep !== undefined && !steps.includes(keep)) steps.push(keep)
  return steps.toSorted((a, b) => a - b)
}

// The source's size within the range, on the API's 2 MiB grid from the minimum.
export function startMemory(memoryMib: number, r: Range): number {
  const v = Math.min(r.max, Math.max(r.min, memoryMib))
  return Math.min(r.max, r.min + Math.ceil((v - r.min) / 2) * 2)
}

export function vcpuSteps(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

interface Resources {
  vcpu: number
  memoryMib: number
  vcpuMax?: number
  memoryMaxMib?: number
}

/** "1 vCPU · 1 GB · can grow to 4 vCPU · 4 GB", or "2 vCPU · 2 GB" when fixed. */
export function sizeLine(r: Resources): string {
  const base = `${formatVcpu(r.vcpu)} · ${formatMib(r.memoryMib)}`
  const grow = [
    r.vcpuMax != null && r.vcpuMax > r.vcpu ? formatVcpu(r.vcpuMax) : null,
    r.memoryMaxMib != null && r.memoryMaxMib > r.memoryMib
      ? formatMib(r.memoryMaxMib)
      : null,
  ].filter(Boolean)
  return grow.length ? `${base} · can grow to ${grow.join(" · ")}` : base
}

export interface Range {
  min: number
  max: number
}

/** What a sandbox gets by default from its source, and what it may choose. */
export interface SizeSource {
  vcpu: number
  memoryMib: number
  line: string
  vcpuRange?: Range
  memoryRange?: Range
}

export function templateSource(t: SizeRange): SizeSource {
  return {
    vcpu: t.vcpu,
    memoryMib: t.memory_mib,
    line: sizeLine({
      vcpu: t.vcpu,
      memoryMib: t.memory_mib,
      vcpuMax: t.vcpu_max,
      memoryMaxMib: t.memory_max_mib,
    }),
    vcpuRange: hasCpuRange(t) ? { min: t.vcpu, max: t.vcpu_max } : undefined,
    memoryRange: hasMemoryRange(t)
      ? { min: t.memory_mib, max: t.memory_max_mib }
      : undefined,
  }
}

export function snapshotSource(r: {
  vcpu_count: number
  memory_mib: number
  vcpu_max?: number
  memory_max_mib?: number
  vcpu_range?: Range
  memory_range_mib?: Range
}): SizeSource {
  return {
    vcpu: r.vcpu_count,
    memoryMib: r.memory_mib,
    line: `${sizeLine({
      vcpu: r.vcpu_count,
      memoryMib: r.memory_mib,
      vcpuMax: r.vcpu_max,
      memoryMaxMib: r.memory_max_mib,
    })} · from snapshot`,
    vcpuRange: r.vcpu_range,
    memoryRange: r.memory_range_mib,
  }
}

/** The size a sandbox gets: the chosen values, else the source's default line. */
export function chosenSizeLine(
  src: SizeSource,
  vcpu: number | null,
  memoryMib: number | null,
): string {
  if (vcpu === null && memoryMib === null) return src.line
  return `${formatVcpu(vcpu ?? src.vcpu)} · ${formatMib(memoryMib ?? src.memoryMib)}`
}

export function SizeLine({ text }: { text: string }) {
  return (
    <p className="font-mono text-xs text-muted uppercase">
      Size <span className="ml-2 text-foreground normal-case">{text}</span>
    </p>
  )
}

function ChoiceRow({
  label,
  range,
  children,
}: {
  label: string
  range: string
  children?: React.ReactNode
}) {
  return (
    <div className={ROW_GRID}>
      <span className="border-l border-dashed border-control pl-3 text-sm text-foreground">
        {label}
      </span>
      {children ?? <span />}
      <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block">
        {range}
      </span>
    </div>
  )
}

const linkButton =
  "cursor-pointer font-mono text-xs text-foreground uppercase underline decoration-dashed underline-offset-2 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"

/**
 * The source's default size, and when it has a range a "Choose size" control:
 * steppers within the range for each resource that has one. Choosing is open
 * while either value is set.
 */
export function SizeSection({
  source,
  vcpu,
  memoryMib,
  onChange,
}: {
  source: SizeSource
  vcpu: number | null
  memoryMib: number | null
  onChange: (vcpu: number | null, memoryMib: number | null) => void
}) {
  const { vcpuRange, memoryRange } = source
  const choosing = vcpu !== null || memoryMib !== null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SizeLine text={source.line} />
        {(vcpuRange || memoryRange) && (
          <button
            type="button"
            aria-expanded={choosing}
            className={linkButton}
            onClick={() =>
              choosing
                ? onChange(null, null)
                : onChange(
                    vcpuRange ? clamp(source.vcpu, vcpuRange) : null,
                    memoryRange
                      ? startMemory(source.memoryMib, memoryRange)
                      : null,
                  )
            }
          >
            {choosing ? "Use default" : "Choose size"}
          </button>
        )}
      </div>
      {choosing && (
        <div className="space-y-1">
          {vcpuRange && vcpu !== null ? (
            <ChoiceRow label="vCPU" range={`${vcpuRange.min}–${vcpuRange.max}`}>
              <Stepper
                label="vCPU"
                steps={vcpuSteps(vcpuRange.min, vcpuRange.max)}
                value={vcpu}
                onChange={(v) => onChange(v, memoryMib)}
                format={formatVcpu}
              />
            </ChoiceRow>
          ) : (
            <ChoiceRow label="vCPU" range={formatVcpu(source.vcpu)} />
          )}
          {memoryRange && memoryMib !== null ? (
            <ChoiceRow
              label="Memory"
              range={formatMibRange(memoryRange.min, memoryRange.max)}
            >
              <Stepper
                label="Memory"
                steps={memorySteps(
                  memoryRange.min,
                  memoryRange.max,
                  startMemory(source.memoryMib, memoryRange),
                )}
                value={memoryMib}
                onChange={(m) => onChange(vcpu, m)}
                format={formatMib}
              />
            </ChoiceRow>
          ) : (
            <ChoiceRow label="Memory" range={formatMib(source.memoryMib)} />
          )}
        </div>
      )}
    </div>
  )
}

function clamp(n: number, r: Range): number {
  return Math.min(r.max, Math.max(r.min, n))
}
