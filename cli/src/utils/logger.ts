import { ansi } from "../config/theme"

function colorize(text: string, color: string): string {
  if (!color) return text
  return `${color}${text}${ansi.reset}`
}

export const log = {
  success(message: string): void {
    const symbol = colorize("\u2713", ansi.success)
    console.error(`${symbol} ${message}`)
  },

  error(message: string): void {
    const symbol = colorize("\u2717", ansi.error)
    console.error(`${symbol} ${message}`)
  },

  warning(message: string): void {
    const symbol = colorize("\u26a0", ansi.warning)
    console.error(`${symbol} ${message}`)
  },

  info(message: string): void {
    console.error(message)
  },

  hint(message: string): void {
    console.error(colorize(`  ${message}`, ansi.muted))
  },

  muted(message: string): void {
    console.error(colorize(message, ansi.muted))
  },
}
