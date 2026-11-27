// The New template dialog's shape as a CLI command and SDK calls, so the
// "View as code" panel shows exactly what Create & build sends.
import type { CreateTemplateRequest } from "@/lib/api/types"

export interface TemplateShape {
  name: string
  from: string
  vcpu: number
  /** Ceiling for live CPU resizing; null keeps the vCPU count fixed. */
  vcpuMax: number | null
  memoryMib: number
  /** Ceiling for live memory resizing; null keeps memory fixed. */
  memoryMaxMib: number | null
  /** Seconds memory stays low before shrinking; null takes the platform default. */
  memoryShrinkAfterSeconds: number | null
  /** Sizes each sandbox may choose at create; null when it can't choose. */
  sizeRange: { vcpuMax?: number; memoryMaxMib?: number } | null
  diskMib: number
}

// The request Create & build sends; the snippets below describe the same shape.
export function createRequest(shape: TemplateShape): CreateTemplateRequest {
  return {
    name: shape.name,
    vcpu: shape.vcpu,
    ...(shape.vcpuMax !== null && { vcpu_max: shape.vcpuMax }),
    memory_mib: shape.memoryMib,
    ...(shape.memoryMaxMib !== null && { memory_max_mib: shape.memoryMaxMib }),
    ...(shape.memoryShrinkAfterSeconds !== null && {
      memory_shrink_after_seconds: shape.memoryShrinkAfterSeconds,
    }),
    ...(shape.sizeRange !== null && {
      size_range: {
        ...(shape.sizeRange.vcpuMax !== undefined && {
          vcpu_max: shape.sizeRange.vcpuMax,
        }),
        ...(shape.sizeRange.memoryMaxMib !== undefined && {
          memory_max_mib: shape.sizeRange.memoryMaxMib,
        }),
      },
    }),
    disk_mib: shape.diskMib,
    build_spec: { from: shape.from },
  }
}

const SHELL_SAFE = /^[\w@%+=:,./-]+$/

// Single-quotes a value the shell would otherwise split or expand.
export function shellQuote(value: string): string {
  if (SHELL_SAFE.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// Same units the CLI prints and parses: whole GiB as "2G", else MiB as "512M".
export function cliSize(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024}G` : `${mib}M`
}

function nameOf(shape: TemplateShape): string {
  return shape.name || "<name>"
}

function imageOf(shape: TemplateShape): string {
  return shape.from || "<image>"
}

export function cliCommand(shape: TemplateShape): string {
  return [
    `superserve template create ${shellQuote(nameOf(shape))}`,
    `--from ${shellQuote(imageOf(shape))}`,
    `--vcpu ${shape.vcpu}`,
    ...(shape.vcpuMax === null ? [] : [`--vcpu-max ${shape.vcpuMax}`]),
    `--memory ${cliSize(shape.memoryMib)}`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`--memory-max ${cliSize(shape.memoryMaxMib)}`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`--memory-shrink-after ${shape.memoryShrinkAfterSeconds}`]),
    ...(shape.sizeRange?.vcpuMax === undefined
      ? []
      : [`--size-range-vcpu-max ${shape.sizeRange.vcpuMax}`]),
    ...(shape.sizeRange?.memoryMaxMib === undefined
      ? []
      : [`--size-range-memory-max ${cliSize(shape.sizeRange.memoryMaxMib)}`]),
    `--disk ${cliSize(shape.diskMib)}`,
  ].join(" \\\n  ")
}

type Range = NonNullable<TemplateShape["sizeRange"]>

function tsRange(r: Range): string {
  const fields = [
    ...(r.vcpuMax === undefined ? [] : [`vcpuMax: ${r.vcpuMax}`]),
    ...(r.memoryMaxMib === undefined
      ? []
      : [`memoryMaxMib: ${r.memoryMaxMib}`]),
  ]
  return `{ ${fields.join(", ")} }`
}

function pyRange(r: Range): string {
  const fields = [
    ...(r.vcpuMax === undefined ? [] : [`vcpu_max=${r.vcpuMax}`]),
    ...(r.memoryMaxMib === undefined
      ? []
      : [`memory_max_mib=${r.memoryMaxMib}`]),
  ]
  return `TemplateSizeRange(${fields.join(", ")})`
}

export function typescriptSnippet(shape: TemplateShape): string {
  return [
    `import { Template } from "@superserve/sdk"`,
    ``,
    `const template = await Template.create({`,
    `  name: ${JSON.stringify(nameOf(shape))},`,
    `  from: ${JSON.stringify(imageOf(shape))},`,
    `  vcpu: ${shape.vcpu},`,
    ...(shape.vcpuMax === null ? [] : [`  vcpuMax: ${shape.vcpuMax},`]),
    `  memoryMib: ${shape.memoryMib},`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`  memoryMaxMib: ${shape.memoryMaxMib},`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`  memoryShrinkAfterSeconds: ${shape.memoryShrinkAfterSeconds},`]),
    ...(shape.sizeRange === null
      ? []
      : [`  sizeRange: ${tsRange(shape.sizeRange)},`]),
    `  diskMib: ${shape.diskMib},`,
    `})`,
    `await template.waitUntilReady()`,
  ].join("\n")
}

export function pythonSnippet(shape: TemplateShape): string {
  return [
    shape.sizeRange === null
      ? `from superserve import Template`
      : `from superserve import Template, TemplateSizeRange`,
    ``,
    `template = Template.create(`,
    `    name=${JSON.stringify(nameOf(shape))},`,
    `    from_=${JSON.stringify(imageOf(shape))},`,
    `    vcpu=${shape.vcpu},`,
    ...(shape.vcpuMax === null ? [] : [`    vcpu_max=${shape.vcpuMax},`]),
    `    memory_mib=${shape.memoryMib},`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`    memory_max_mib=${shape.memoryMaxMib},`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`    memory_shrink_after_seconds=${shape.memoryShrinkAfterSeconds},`]),
    ...(shape.sizeRange === null
      ? []
      : [`    size_range=${pyRange(shape.sizeRange)},`]),
    `    disk_mib=${shape.diskMib},`,
    `)`,
    `template.wait_until_ready()`,
  ].join("\n")
}
