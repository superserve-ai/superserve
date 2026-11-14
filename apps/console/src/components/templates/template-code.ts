// The New template dialog's shape as a CLI command and SDK calls, so the
// "View as code" panel shows exactly what Create & build sends.
import type { CreateTemplateRequest } from "@/lib/api/types"

export interface TemplateShape {
  name: string
  from: string
  vcpu: number
  memoryMib: number
  /** Ceiling for live memory resizing; null keeps memory fixed. */
  memoryMaxMib: number | null
  /** Seconds memory stays low before shrinking; null takes the platform default. */
  memoryShrinkAfterSeconds: number | null
  diskMib: number
}

// The request Create & build sends; the snippets below describe the same shape.
export function createRequest(shape: TemplateShape): CreateTemplateRequest {
  return {
    name: shape.name,
    vcpu: shape.vcpu,
    memory_mib: shape.memoryMib,
    ...(shape.memoryMaxMib !== null && { memory_max_mib: shape.memoryMaxMib }),
    ...(shape.memoryShrinkAfterSeconds !== null && {
      memory_shrink_after_seconds: shape.memoryShrinkAfterSeconds,
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
    `--memory ${cliSize(shape.memoryMib)}`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`--memory-max ${cliSize(shape.memoryMaxMib)}`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`--memory-shrink-after ${shape.memoryShrinkAfterSeconds}`]),
    `--disk ${cliSize(shape.diskMib)}`,
  ].join(" \\\n  ")
}

export function typescriptSnippet(shape: TemplateShape): string {
  return [
    `import { Template } from "@superserve/sdk"`,
    ``,
    `const template = await Template.create({`,
    `  name: ${JSON.stringify(nameOf(shape))},`,
    `  from: ${JSON.stringify(imageOf(shape))},`,
    `  vcpu: ${shape.vcpu},`,
    `  memoryMib: ${shape.memoryMib},`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`  memoryMaxMib: ${shape.memoryMaxMib},`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`  memoryShrinkAfterSeconds: ${shape.memoryShrinkAfterSeconds},`]),
    `  diskMib: ${shape.diskMib},`,
    `})`,
    `await template.waitUntilReady()`,
  ].join("\n")
}

export function pythonSnippet(shape: TemplateShape): string {
  return [
    `from superserve import Template`,
    ``,
    `template = Template.create(`,
    `    name=${JSON.stringify(nameOf(shape))},`,
    `    from_=${JSON.stringify(imageOf(shape))},`,
    `    vcpu=${shape.vcpu},`,
    `    memory_mib=${shape.memoryMib},`,
    ...(shape.memoryMaxMib === null
      ? []
      : [`    memory_max_mib=${shape.memoryMaxMib},`]),
    ...(shape.memoryShrinkAfterSeconds === null
      ? []
      : [`    memory_shrink_after_seconds=${shape.memoryShrinkAfterSeconds},`]),
    `    disk_mib=${shape.diskMib},`,
    `)`,
    `template.wait_until_ready()`,
  ].join("\n")
}
