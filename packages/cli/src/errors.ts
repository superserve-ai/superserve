import {
  AuthenticationError,
  BuildError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@superserve/sdk"
import { CommanderError } from "commander"

import { isJson, printError, printJson, success } from "./output"

/** Exit codes. A command's own exit code (exec) passes through untouched. */
export const EXIT = {
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  CONFLICT: 5,
  RATE_LIMIT: 6,
  TIMEOUT: 7,
  INTERRUPTED: 130,
} as const

/** An error meant for the user: printed as-is, never with a stack. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.ERROR,
    readonly hint?: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = "CliError"
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, EXIT.USAGE, hint, "usage")
}

interface Described {
  message: string
  exitCode: number
  hint?: string
  code?: string
  status?: number
}

function describe(err: unknown): Described {
  if (err instanceof CliError) {
    return {
      message: err.message,
      exitCode: err.exitCode,
      hint: err.hint,
      code: err.code,
    }
  }
  if (err instanceof SandboxError) {
    const base = {
      message: err.message,
      code: err.code,
      status: err.statusCode,
    }
    if (err instanceof AuthenticationError) {
      return {
        ...base,
        exitCode: EXIT.AUTH,
        hint:
          err.statusCode === 403
            ? "Your API key does not have access to this resource."
            : "Run `superserve login`, or set SUPERSERVE_API_KEY.",
      }
    }
    if (err instanceof NotFoundError)
      return { ...base, exitCode: EXIT.NOT_FOUND }
    if (err instanceof ConflictError) {
      return {
        ...base,
        exitCode: EXIT.CONFLICT,
        hint:
          err.code === "sandbox_pausing"
            ? "The sandbox is still pausing. Retry in a few seconds."
            : undefined,
      }
    }
    if (err instanceof RateLimitError) {
      return { ...base, exitCode: EXIT.RATE_LIMIT }
    }
    if (err instanceof TimeoutError) {
      return { ...base, exitCode: EXIT.TIMEOUT }
    }
    if (err instanceof BuildError) {
      // Build logs are streamed live only; nothing to point at afterwards.
      return { ...base, exitCode: EXIT.ERROR }
    }
    if (err instanceof ValidationError) return { ...base, exitCode: EXIT.USAGE }
    if (err instanceof ServerError) {
      return {
        ...base,
        exitCode: EXIT.ERROR,
        hint: "This is a Superserve server error. Retry shortly; if it persists, contact support@superserve.ai.",
      }
    }
    return { ...base, exitCode: EXIT.ERROR }
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { message: "Interrupted", exitCode: EXIT.INTERRUPTED }
  }
  if (err instanceof Error) {
    // fetch() failures surface as TypeError with the cause attached.
    const cause = (err as { cause?: { code?: string } }).cause
    if (err instanceof TypeError && cause?.code) {
      return {
        message: `Network error: ${cause.code}`,
        exitCode: EXIT.ERROR,
        hint: "Check your connection, or SUPERSERVE_BASE_URL if you set it.",
      }
    }
    return { message: err.message, exitCode: EXIT.ERROR }
  }
  return { message: String(err), exitCode: EXIT.ERROR }
}

/** Bulk results: name every failure; the exit code is the first failure's. */
export function reportBatch(
  ids: string[],
  labels: string[],
  results: PromiseSettledResult<unknown>[],
  doneMessage: (label: string) => string,
  doneStatus: string,
): void {
  let exitCode = 0
  const rows = results.map((r, i) => {
    if (r.status === "fulfilled") {
      if (!isJson()) success(doneMessage(labels[i]))
      return { id: ids[i], status: doneStatus }
    }
    const d = describe(r.reason)
    exitCode ||= d.exitCode
    if (!isJson()) printError(`${labels[i]}: ${d.message}`, d.hint)
    return {
      id: ids[i],
      error: { message: d.message, code: d.code, status: d.status },
    }
  })
  if (isJson()) printJson(rows)
  if (exitCode) process.exitCode = exitCode
}

/** Print an error in the active output mode and return the exit code. */
export function handleError(err: unknown): number {
  if (err instanceof CommanderError) {
    // Commander already printed its message; help/version exit cleanly.
    return err.exitCode === 0 ? 0 : EXIT.USAGE
  }
  const d = describe(err)
  if (isJson()) {
    printError({
      error: { message: d.message, code: d.code, status: d.status },
    })
  } else {
    printError(d.message, d.hint)
  }
  if (process.env.SUPERSERVE_DEBUG && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`)
  }
  return d.exitCode
}
