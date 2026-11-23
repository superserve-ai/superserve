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
export function memorySteps(min: number, max: number): number[] {
  const steps: number[] = []
  for (let v = min; v < max; v += MEMORY_STEP_MIB) steps.push(v)
  steps.push(max)
  return steps
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

export function templateResources(t: SizeRange): Resources {
  return {
    vcpu: t.vcpu,
    memoryMib: t.memory_mib,
    vcpuMax: t.vcpu_max,
    memoryMaxMib: t.memory_max_mib,
  }
}

export function snapshotResources(r: {
  vcpu_count: number
  memory_mib: number
  vcpu_max?: number
  memory_max_mib?: number
}): Resources {
  return {
    vcpu: r.vcpu_count,
    memoryMib: r.memory_mib,
    vcpuMax: r.vcpu_max,
    memoryMaxMib: r.memory_max_mib,
  }
}

/** The size a sandbox gets: the chosen values, else the template's default line. */
export function chosenSizeLine(
  t: SizeRange,
  vcpu: number | null,
  memoryMib: number | null,
): string {
  if (vcpu === null && memoryMib === null) return sizeLine(templateResources(t))
  return `${formatVcpu(vcpu ?? t.vcpu)} · ${formatMib(memoryMib ?? t.memory_mib)}`
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
 * The template's default size, and for a template with a range a "Choose
 * size" control: steppers within the range for each resource that has one.
 * Choosing is open while either value is set.
 */
export function TemplateSizeSection({
  template,
  vcpu,
  memoryMib,
  onChange,
}: {
  template: SizeRange
  vcpu: number | null
  memoryMib: number | null
  onChange: (vcpu: number | null, memoryMib: number | null) => void
}) {
  const cpuRange = hasCpuRange(template) ? template : undefined
  const memoryRange = hasMemoryRange(template) ? template : undefined
  const choosing = vcpu !== null || memoryMib !== null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SizeLine text={sizeLine(templateResources(template))} />
        {(cpuRange || memoryRange) && (
          <button
            type="button"
            aria-expanded={choosing}
            className={linkButton}
            onClick={() =>
              choosing
                ? onChange(null, null)
                : onChange(
                    cpuRange ? cpuRange.vcpu : null,
                    memoryRange ? memoryRange.memory_mib : null,
                  )
            }
          >
            {choosing ? "Use default" : "Choose size"}
          </button>
        )}
      </div>
      {choosing && (
        <div className="space-y-1">
          {cpuRange && vcpu !== null ? (
            <ChoiceRow
              label="vCPU"
              range={`${cpuRange.vcpu}–${cpuRange.vcpu_max}`}
            >
              <Stepper
                label="vCPU"
                steps={vcpuSteps(cpuRange.vcpu, cpuRange.vcpu_max)}
                value={vcpu}
                onChange={(v) => onChange(v, memoryMib)}
                format={formatVcpu}
              />
            </ChoiceRow>
          ) : (
            <ChoiceRow label="vCPU" range={formatVcpu(template.vcpu)} />
          )}
          {memoryRange && memoryMib !== null ? (
            <ChoiceRow
              label="Memory"
              range={formatMibRange(
                memoryRange.memory_mib,
                memoryRange.memory_max_mib,
              )}
            >
              <Stepper
                label="Memory"
                steps={memorySteps(
                  memoryRange.memory_mib,
                  memoryRange.memory_max_mib,
                )}
                value={memoryMib}
                onChange={(m) => onChange(vcpu, m)}
                format={formatMib}
              />
            </ChoiceRow>
          ) : (
            <ChoiceRow label="Memory" range={formatMib(template.memory_mib)} />
          )}
        </div>
      )}
    </div>
  )
}
