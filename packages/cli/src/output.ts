import pc from "picocolors"

// Data (tables, JSON, file contents) goes to stdout; status and errors to stderr,
// so pipes and redirects only ever see data.

let jsonMode = false

export function setJsonMode(on: boolean): void {
  jsonMode = on
}

export function isJson(): boolean {
  return jsonMode
}

const errColor = pc.createColors(
  Boolean(process.stderr.isTTY) && pc.isColorSupported,
)

export const color = pc

/** Commander's own parse errors, as the JSON error object in JSON mode. */
export function commanderError(str: string): string {
  if (!jsonMode) return str
  const message = str.replace(/^error: /, "").trim()
  return `${JSON.stringify({ error: { message, code: "usage" } })}\n`
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** Status line on stderr. Suppressed in JSON mode so stderr stays parseable. */
export function info(message: string): void {
  if (!jsonMode) process.stderr.write(`${message}\n`)
}

export function success(message: string): void {
  if (!jsonMode) process.stderr.write(`${errColor.green("✓")} ${message}\n`)
}

export function warn(message: string): void {
  process.stderr.write(
    jsonMode
      ? `${JSON.stringify({ warning: message })}\n`
      : `${errColor.yellow("!")} ${message}\n`,
  )
}

export function printError(message: string | object, hint?: string): void {
  if (typeof message === "object") {
    process.stderr.write(`${JSON.stringify(message)}\n`)
    return
  }
  process.stderr.write(`${errColor.red("error:")} ${message}\n`)
  if (hint) process.stderr.write(`${errColor.dim(hint)}\n`)
}

/**
 * Text from inside a sandbox (file names, metadata, hosts) is untrusted: escape
 * every control character so it can't drive the terminal. The CLI's own colour
 * is applied after escaping, never passed through it.
 */
export function safeText(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f-\x9f]/g,
    (m) => `\\x${m.charCodeAt(0).toString(16).padStart(2, "0")}`,
  )
}

export interface Column<T> {
  header: string
  value: (row: T) => string | number | undefined | null
  /** Colorize after padding so ANSI codes don't break alignment. */
  style?: (text: string, row: T) => string
}

export function printTable<T>(
  rows: T[],
  columns: Column<T>[],
  empty = "No results.",
): void {
  if (rows.length === 0) {
    info(empty)
    return
  }
  const cells = rows.map((r) =>
    columns.map((c) => safeText(String(c.value(r) ?? "-"))),
  )
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...cells.map((row) => row[i].length)),
  )
  const line = (parts: string[]) => parts.join("  ").trimEnd()
  process.stdout.write(
    `${line(columns.map((c, i) => pc.bold(c.header.toUpperCase().padEnd(widths[i]))))}\n`,
  )
  rows.forEach((row, r) => {
    const parts = columns.map((c, i) => {
      const padded = cells[r][i].padEnd(widths[i])
      return c.style ? c.style(padded, row) : padded
    })
    process.stdout.write(`${line(parts)}\n`)
  })
}

export type Field = [
  label: string,
  value: string | undefined,
  /** Colour applied after the value is escaped. */
  style?: (text: string) => string,
]

export function printFields(fields: Field[]): void {
  const shown = fields.filter(
    (f): f is [string, string, ((t: string) => string)?] => f[1] !== undefined,
  )
  const width = Math.max(0, ...shown.map(([k]) => k.length))
  for (const [k, v, style] of shown) {
    const text = safeText(v)
    process.stdout.write(
      `${pc.dim(`${k}:`.padEnd(width + 1))} ${style ? style(text) : text}\n`,
    )
  }
}

const STATUS_COLORS: Record<string, (s: string) => string> = {
  active: pc.green,
  ready: pc.green,
  allowed: pc.green,
  paused: pc.blue,
  failed: pc.red,
  blocked: pc.red,
  error: pc.red,
}

export function statusColor(text: string): string {
  const fn = STATUS_COLORS[text.trim()] ?? pc.yellow
  return fn(text)
}

export function formatDate(d: Date | string | undefined): string {
  if (!d) return "-"
  const date = typeof d === "string" ? new Date(d) : d
  const secs = Math.round((Date.now() - date.getTime()) / 1000)
  if (secs < 0) return `in ${formatSeconds(-secs)}`
  if (secs < 5) return "just now"
  if (secs >= 30 * 86_400) return date.toISOString().slice(0, 10)
  return `${formatSeconds(secs)} ago`
}

export function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`
  if (total < 86_400) {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    return m ? `${h}h${m}m` : `${h}h`
  }
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  return h ? `${d}d${h}h` : `${d}d`
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

/** No-op unless stderr is a TTY and output isn't JSON, so logs never see control characters. */
export function spinner(text: string): { stop: (final?: string) => void } {
  if (jsonMode || !process.stderr.isTTY) {
    return { stop: () => {} }
  }
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  let i = 0
  const render = () =>
    process.stderr.write(
      `\r${errColor.cyan(frames[i++ % frames.length])} ${text}`,
    )
  render()
  const timer = setInterval(render, 80)
  return {
    stop: (final?: string) => {
      clearInterval(timer)
      process.stderr.write("\r\x1b[2K")
      if (final) success(final)
    },
  }
}

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
): Promise<T> {
  const s = spinner(text)
  try {
    return await fn()
  } finally {
    s.stop()
  }
}
