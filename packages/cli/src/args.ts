import { CliError, EXIT, usageError } from "./errors"

/** Commander reducer for repeatable flags: `-e A=1 -e B=2`. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** `["A=1", "B=x=y"]` → `{ A: "1", B: "x=y" }`. */
export function parseKeyValues(
  pairs: string[] | undefined,
  flag: string,
): Record<string, string> | undefined {
  if (!pairs?.length) return undefined
  // fromEntries defines own properties, so a key like __proto__ is kept.
  return Object.fromEntries(
    pairs.map((pair) => {
      const eq = pair.indexOf("=")
      if (eq <= 0) {
        throw usageError(`Invalid ${flag} "${pair}": expected KEY=VALUE.`)
      }
      return [pair.slice(0, eq), pair.slice(eq + 1)]
    }),
  )
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 }

/** `90` / `90s` / `15m` / `1h30m` / `7d` → seconds. */
export function parseDuration(input: string, flag: string): number {
  const s = input.trim()
  if (/^\d+$/.test(s)) return Number(s)
  const re = /(\d+)([smhd])/gy
  let total = 0
  let consumed = 0
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * UNIT_SECONDS[m[2]]
    consumed += m[0].length
  }
  if (consumed !== s.length || consumed === 0) {
    throw usageError(
      `Invalid ${flag} "${input}": use seconds or a duration like 30s, 15m, 2h, 7d.`,
    )
  }
  return total
}

export function parseInteger(
  input: string,
  flag: string,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const n = Number(input)
  if (!Number.isInteger(n)) throw usageError(`${flag} must be an integer.`)
  if (min !== undefined && n < min)
    throw usageError(`${flag} must be ≥ ${min}.`)
  if (max !== undefined && n > max)
    throw usageError(`${flag} must be ≤ ${max}.`)
  return n
}

/** Require an absolute sandbox path, as the API does. */
export function sandboxPath(p: string): string {
  if (!p.startsWith("/")) {
    throw usageError(`Sandbox path "${p}" must be absolute (start with /).`)
  }
  if (p.split("/").includes("..")) {
    throw usageError(`Sandbox path "${p}" must not contain "..".`)
  }
  return p
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY)
}

/** `--yes` skips; a non-interactive session without it refuses rather than guessing. */
export async function confirm(question: string, yes?: boolean): Promise<void> {
  if (yes) return
  if (!isInteractive()) {
    throw new CliError(
      `${question} Refusing without --yes in a non-interactive session.`,
      EXIT.USAGE,
      undefined,
      "confirmation_required",
    )
  }
  const { createInterface } = await import("node:readline")
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise<string>((resolve) =>
    rl.question(`${question} [y/N] `, resolve),
  )
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new CliError("Aborted.", EXIT.ERROR, undefined, "aborted")
  }
}

export async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Text piped on stdin, or "" when nothing arrives within `waitMs`. Unlike
 * readStdin it never waits on a stdin that stays open without input, as many
 * agent harnesses leave it.
 */
export function readPipedInput(waitMs = 1000): Promise<string> {
  const stdin = process.stdin
  if (stdin.isTTY) return Promise.resolve("")
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const done = () => {
      clearTimeout(timer)
      stdin.off("data", onData)
      stdin.off("end", done)
      stdin.off("error", done)
      stdin.pause()
      resolve(Buffer.concat(chunks).toString("utf8").trim())
    }
    // Keep reading while data flows; stop at EOF or once the pipe goes quiet.
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      clearTimeout(timer)
      timer = setTimeout(done, waitMs)
    }
    let timer = setTimeout(done, waitMs)
    stdin.on("data", onData)
    stdin.once("end", done)
    stdin.once("error", done)
    stdin.resume()
  })
}

/** From stdin when piped, else a hidden prompt; never argv (shell history, `ps`). */
export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const value = (await readStdin()).toString("utf8").replace(/\r?\n$/, "")
    if (!value) throw usageError("Expected a value on stdin, got nothing.")
    return value
  }
  process.stderr.write(prompt)
  const stdin = process.stdin
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  let value = ""
  try {
    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: string) => {
        // Arrow and function keys arrive as one escape-sequence chunk.
        if (chunk.startsWith("\u001b")) return
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") {
            stdin.off("data", onData)
            resolve()
            return
          }
          if (ch === "\u0003") {
            stdin.off("data", onData)
            reject(new CliError("Interrupted", EXIT.INTERRUPTED))
            return
          }
          if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1)
          else if (ch >= " ") value += ch
        }
      }
      stdin.on("data", onData)
    })
  } finally {
    stdin.setRawMode(false)
    stdin.pause()
    process.stderr.write("\n")
  }
  if (!value) throw usageError("No value entered.")
  return value
}
