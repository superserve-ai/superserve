"use client"

import { useId } from "react"

import {
  formatMib,
  formatVcpu,
  ROW_GRID,
  SegmentedChoice,
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
export function memorySteps(min: number, max: number): number[] {
  const steps: number[] = []
  for (let v = min; v < max; v += MEMORY_STEP_MIB) steps.push(v)
  steps.push(max)
  return steps
}

export function vcpuSteps(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
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

export interface DimensionSize {
  text: string
  mode: "auto" | "fixed"
}

/** "2 vCPU · 2 GB · fixed", "1–4 vCPU · 1–4 GB · auto", or per dimension when they differ. */
export function sizeSummary(cpu: DimensionSize, memory: DimensionSize): string {
  return cpu.mode === memory.mode
    ? `${cpu.text} · ${memory.text} · ${cpu.mode}`
    : `${cpu.text} ${cpu.mode} · ${memory.text} ${memory.mode}`
}

/** Size of a sandbox from `template` with optional fixed picks (null = auto). */
export function templateSize(
  template: SizeRange,
  vcpu: number | null,
  memoryMib: number | null,
): { cpu: DimensionSize; memory: DimensionSize } {
  const cpu: DimensionSize =
    hasCpuRange(template) && vcpu === null
      ? {
          text: formatVcpuRange(template.vcpu, template.vcpu_max),
          mode: "auto",
        }
      : { text: formatVcpu(vcpu ?? template.vcpu), mode: "fixed" }
  const memory: DimensionSize =
    hasMemoryRange(template) && memoryMib === null
      ? {
          text: formatMibRange(template.memory_mib, template.memory_max_mib),
          mode: "auto",
        }
      : { text: formatMib(memoryMib ?? template.memory_mib), mode: "fixed" }
  return { cpu, memory }
}

const SIZE_MODES = [
  { value: "auto", text: "Auto" },
  { value: "fixed", text: "Fixed" },
] as const

function DimensionRow({
  label,
  min,
  max,
  steps,
  value,
  onChange,
  format,
  formatRange,
}: {
  label: string
  min: number
  max: number
  steps: number[]
  value: number | null
  onChange: (value: number | null) => void
  format: (v: number) => string
  formatRange: (min: number, max: number) => string
}) {
  const id = useId()
  return (
    <div className="space-y-1 py-2">
      <div className={ROW_GRID}>
        <span id={`${id}-label`} className="text-sm text-foreground">
          {label}
        </span>
        <SegmentedChoice
          value={value === null ? "auto" : "fixed"}
          labelledBy={`${id}-label`}
          options={SIZE_MODES}
          onChange={(mode) => onChange(mode === "auto" ? null : min)}
        />
        <span className="hidden sm:block" />
      </div>
      <div className={ROW_GRID}>
        <span className="border-l border-dashed border-control pl-3 text-xs text-muted">
          {value === null
            ? `Auto: ${formatRange(min, max)}, grows with load`
            : "Fixed for this sandbox"}
        </span>
        {value !== null && (
          <Stepper
            label={label}
            steps={steps}
            value={value}
            onChange={onChange}
            format={format}
          />
        )}
        {value !== null && (
          <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block">
            ({formatRange(min, max)})
          </span>
        )}
      </div>
    </div>
  )
}

function ReadOnlySize({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-xs text-muted uppercase">
        Size <span className="ml-2 text-foreground normal-case">{text}</span>
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

/**
 * Size for a sandbox from a template: Auto (the template's range, growing
 * with load) or Fixed within it, per dimension the template has a range for.
 */
export function TemplateSizeSection({
  template,
  vcpu,
  memoryMib,
  onVcpuChange,
  onMemoryChange,
}: {
  template: SizeRange
  vcpu: number | null
  memoryMib: number | null
  onVcpuChange: (v: number | null) => void
  onMemoryChange: (v: number | null) => void
}) {
  const cpuRange = hasCpuRange(template) ? template : undefined
  const memoryRange = hasMemoryRange(template) ? template : undefined
  if (!cpuRange && !memoryRange) {
    return (
      <ReadOnlySize
        text={`${formatVcpu(template.vcpu)} · ${formatMib(template.memory_mib)} · fixed by template`}
        hint="To choose sizes, build a template with a size range."
      />
    )
  }
  return (
    <section aria-label="Size">
      <h3 className="border-b border-dashed border-border pb-2 font-mono text-xs tracking-wider text-muted uppercase">
        Size
      </h3>
      <div className="divide-y divide-dashed divide-border">
        {cpuRange && (
          <DimensionRow
            label="vCPU"
            min={cpuRange.vcpu}
            max={cpuRange.vcpu_max}
            steps={vcpuSteps(cpuRange.vcpu, cpuRange.vcpu_max)}
            value={vcpu}
            onChange={onVcpuChange}
            format={formatVcpu}
            formatRange={formatVcpuRange}
          />
        )}
        {memoryRange && (
          <DimensionRow
            label="Memory"
            min={memoryRange.memory_mib}
            max={memoryRange.memory_max_mib}
            steps={memorySteps(
              memoryRange.memory_mib,
              memoryRange.memory_max_mib,
            )}
            value={memoryMib}
            onChange={onMemoryChange}
            format={formatMib}
            formatRange={formatMibRange}
          />
        )}
      </div>
      {(!cpuRange || !memoryRange) && (
        <p className="pt-1 text-xs text-muted">
          {cpuRange
            ? `Memory: ${formatMib(template.memory_mib)}, fixed by template`
            : `vCPU: ${formatVcpu(template.vcpu)}, fixed by template`}
        </p>
      )}
    </section>
  )
}

interface SnapshotResources {
  vcpu_count: number
  memory_mib: number
  vcpu_max?: number
  memory_max_mib?: number
}

export function snapshotSize(r: SnapshotResources): {
  cpu: DimensionSize
  memory: DimensionSize
} {
  return {
    cpu: {
      text: formatVcpuRange(r.vcpu_count, r.vcpu_max),
      mode: r.vcpu_max == null ? "fixed" : "auto",
    },
    memory: {
      text: formatMibRange(r.memory_mib, r.memory_max_mib),
      mode: r.memory_max_mib == null ? "fixed" : "auto",
    },
  }
}

/** A snapshot's size, read-only: copies start with it. */
export function SnapshotSize({ resources }: { resources: SnapshotResources }) {
  const { cpu, memory } = snapshotSize(resources)
  return <ReadOnlySize text={`${cpu.text} · ${memory.text} · from snapshot`} />
}
