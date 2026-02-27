import pc from "picocolors"

const { blue, dim, green, red, yellow } = pc

const SESSION_STATUS_COLORS: Record<string, (t: string) => string> = {
  active: green,
  running: green,
  idle: yellow,
  completed: blue,
  ended: dim,
  failed: red,
  error: red,
  pending: yellow,
}

export function coloredSessionStatus(status: string): string {
  const upper = status.toUpperCase()
  const colorize = SESSION_STATUS_COLORS[status]
  return colorize ? colorize(upper) : upper
}
