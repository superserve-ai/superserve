import pc from "picocolors"

const { green, red, yellow } = pc

const STATUS_LABELS: Record<string, string> = {
  none: "READY",
  ready: "READY",
  installing: "DEPLOYING",
  failed: "FAILED",
}

const STATUS_COLORIZE: Record<string, (text: string) => string> = {
  none: green,
  ready: green,
  installing: yellow,
  failed: red,
}

export function agentStatus(depsStatus: string): string {
  return STATUS_LABELS[depsStatus] ?? depsStatus.toUpperCase()
}

export function coloredStatus(depsStatus: string): string {
  const label = agentStatus(depsStatus)
  const colorize = STATUS_COLORIZE[depsStatus]
  return colorize ? colorize(label) : label
}
