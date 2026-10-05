// Type declarations for template.mjs.
import type { BuildLogEvent, Template } from "@superserve/sdk"

export const TEMPLATE_NAME: string
/** Short fingerprint of TEMPLATE_SPEC; changes whenever the spec does. */
export const TEMPLATE_SPEC_HASH: string

export const TEMPLATE_SPEC: {
  from: string
  vcpu: number
  memoryMib: number
  diskMib: number
  steps: Array<{ run: string } | { workdir: string }>
}

/** The CLI release cursor.com/install currently ships, e.g. "2026.09.08-6caf4ff". */
export function resolveCursorCliVersion(opts?: {
  timeoutMs?: number
}): Promise<string>

export function ensureTemplate(opts?: {
  name?: string
  onLog?: (event: BuildLogEvent) => void
  log?: (message: string) => void
}): Promise<Template>
