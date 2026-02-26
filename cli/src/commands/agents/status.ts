import pc from "picocolors"

const { green, red, yellow } = pc

const STATUS_LABELS: Record<string, string> = {
  none: "READY",
  ready: "READY",
  building: "DEPLOYING",
  failed: "FAILED",
}

const STATUS_COLORIZE: Record<string, (text: string) => string> = {
  none: green,
  ready: green,
  building: yellow,
  failed: red,
}

export function agentStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.toUpperCase()
}

export function coloredStatus(status: string): string {
  const label = agentStatus(status)
  const colorize = STATUS_COLORIZE[status]
  return colorize ? colorize(label) : label
}
