import { flushAnalytics, track } from "./analytics"
import { ERROR_HINTS, PlatformAPIError } from "./api/errors"
import { log } from "./utils/logger"

export function handleError(e: unknown): number {
  if (e instanceof PlatformAPIError) {
    log.error(e.message)
    // Skip hint for 409 — the API message is already specific enough
    if (e.statusCode !== 409) {
      const hint = ERROR_HINTS[e.statusCode]
      if (hint) log.hint(hint)
    }
    return 1
  }

  if (
    e instanceof Error &&
    (e.name === "AbortError" || e.message === "SIGINT")
  ) {
    console.error()
    return 130
  }

  if (e instanceof Error) {
    log.error("An unexpected error occurred. Please try again.")
    return 1
  }

  log.error("An unexpected error occurred. Please try again.")
  return 1
}

function errorProperties(e: unknown): Record<string, unknown> {
  if (e instanceof PlatformAPIError) {
    return {
      error_type: "api",
      error_status: e.statusCode,
      error_message: e.message,
    }
  }
  if (
    e instanceof Error &&
    (e.name === "AbortError" || e.message === "SIGINT")
  ) {
    return { error_type: "cancelled" }
  }
  if (e instanceof Error) {
    return { error_type: "unexpected", error_message: e.message }
  }
  return { error_type: "unknown" }
}

// biome-ignore lint/suspicious/noExplicitAny: Commander passes variadic args
export function withErrorHandler<T extends (...args: any[]) => Promise<void>>(
  fn: T,
): T {
  // biome-ignore lint/suspicious/noExplicitAny: wraps Commander action callbacks
  const wrapped = async (...args: any[]) => {
    try {
      await fn(...args)
    } catch (e) {
      await track("cli_error", errorProperties(e))
      await flushAnalytics()
      process.exitCode = handleError(e)
    }
  }
  return wrapped as T
}
