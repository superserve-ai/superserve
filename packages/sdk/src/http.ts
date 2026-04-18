/**
 * Minimal HTTP client wrapping native `fetch`.
 *
 * Handles:
 * - Auth header injection (`X-API-Key`)
 * - JSON request/response serialization
 * - Error mapping to typed SDK errors
 * - Request timeout via AbortController
 * - SSE stream parsing for exec/stream endpoint
 * - Exponential-backoff retry on idempotent operations (GET/DELETE)
 */

import { mapApiError, SandboxError, TimeoutError } from "./errors.js"
import type { ApiExecStreamEvent } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000

const SDK_VERSION = "0.6.0"
const USER_AGENT = `@superserve/sdk/${SDK_VERSION} (node/${
  typeof process !== "undefined" && process.versions?.node
    ? `v${process.versions.node}`
    : "unknown"
})`

// Retry tuning
const DEFAULT_MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 100
const MAX_BACKOFF_MS = 30_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Compose an internal controller signal with an optional user signal.
 * Uses AbortSignal.any when available.
 */
function composeSignals(
  internal: AbortSignal,
  user?: AbortSignal,
): AbortSignal {
  if (!user) return internal
  return AbortSignal.any([internal, user])
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse a Retry-After header value.
 * Returns milliseconds to wait, capped at MAX_BACKOFF_MS, or null if invalid.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Numeric seconds
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, MAX_BACKOFF_MS)
  }
  // HTTP-date
  const asDate = Date.parse(trimmed)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta <= 0) return 0
    return Math.min(delta, MAX_BACKOFF_MS)
  }
  return null
}

function backoffDelay(attempt: number): number {
  // Attempt 1 → 100ms, attempt 2 → 200ms, attempt 3 → 400ms, etc.
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1)
  const jitter = base * (0.8 + Math.random() * 0.4)
  return Math.min(jitter, MAX_BACKOFF_MS)
}

/**
 * Is this error a network-level transient error worth retrying?
 *
 * `fetch` throws a `TypeError` for network failures (connection refused,
 * DNS failure, reset, etc). AbortErrors should NOT be treated as network
 * errors — they're explicit cancellations.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false
  if (err instanceof TypeError) return true
  // Node fetch sometimes surfaces errors with name "FetchError" or a cause
  if (
    err instanceof Error &&
    (err.name === "FetchError" || err.name === "NetworkError")
  ) {
    return true
  }
  return false
}

/**
 * Internal fetch wrapper with per-attempt timeout, abort-signal composition,
 * and optional retry on transient conditions (429, 5xx, network errors).
 *
 * Only retries when `opts.retryable` is true. Callers must ensure the
 * operation is idempotent before enabling retries.
 */
async function retryableFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: {
    timeoutMs: number
    maxAttempts?: number
    retryable: boolean
    userSignal?: AbortSignal
  },
): Promise<Response> {
  const maxAttempts = opts.retryable ? (opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) : 1

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, opts.timeoutMs)

    const signal = composeSignals(controller.signal, opts.userSignal)

    try {
      const res = await fetch(input, { ...init, signal })

      // Retry on specific 5xx / 429
      if (opts.retryable && RETRYABLE_STATUSES.has(res.status)) {
        if (attempt >= maxAttempts) {
          return res
        }
        let delay: number | null = null
        if (res.status === 429) {
          delay = parseRetryAfter(res.headers.get("Retry-After"))
        }
        if (delay === null) {
          delay = backoffDelay(attempt)
        }
        // Drain body so the connection can be released
        try {
          await res.arrayBuffer()
        } catch {
          // ignore
        }
        clearTimeout(timer)
        await sleep(delay)
        continue
      }

      return res
    } catch (err) {
      lastError = err

      // User cancellation propagates immediately, never retried
      if (opts.userSignal?.aborted) {
        throw err
      }

      // Internal timeout — surface as TimeoutError
      if (timedOut) {
        throw new TimeoutError(`Request timed out after ${opts.timeoutMs}ms`)
      }

      // Non-network / non-timeout aborts (rare): treat as cancellation
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err
      }

      // Retry network errors if retryable and attempts remain
      if (opts.retryable && isNetworkError(err) && attempt < maxAttempts) {
        await sleep(backoffDelay(attempt))
        continue
      }

      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // Shouldn't be reachable — the loop either returns or throws
  throw lastError ?? new SandboxError("Request failed with no response")
}

async function readErrorBody(
  res: Response,
): Promise<{ error?: { code?: string; message?: string } }> {
  try {
    return (await res.json()) as { error?: { code?: string; message?: string } }
  } catch {
    return {}
  }
}

/**
 * Make an HTTP request and return parsed JSON.
 *
 * Throws typed SandboxError subclasses on non-2xx responses.
 *
 * Retries GET/DELETE on transient failures (429, 502/503/504, network errors).
 * POST/PATCH are never retried (not idempotent).
 */
export async function request<T>(opts: RequestOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
  } = opts

  const retryable = method === "GET" || method === "DELETE"
  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      {
        method,
        headers: mergedHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { timeoutMs, retryable, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Request aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Make a request that returns no body (204 expected).
 */
export async function requestVoid(opts: RequestOptions): Promise<void> {
  await request<void>(opts)
}

/**
 * Upload raw bytes to a URL. Used for file upload to the data plane.
 *
 * Not retried — POST is not idempotent.
 */
export async function uploadBytes(opts: {
  url: string
  headers: Record<string, string>
  body: BodyInit
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<void> {
  const {
    url,
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
  } = opts

  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/octet-stream",
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      { method: "POST", headers: mergedHeaders, body },
      { timeoutMs, retryable: false, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Upload aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Upload error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Download raw bytes from a URL. Used for file download from the data plane.
 *
 * Retries on transient failures (GET is idempotent).
 */
export async function downloadBytes(opts: {
  url: string
  headers: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<Uint8Array> {
  const {
    url,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: userSignal,
  } = opts

  const mergedHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    ...headers,
  }

  try {
    const res = await retryableFetch(
      url,
      { method: "GET", headers: mergedHeaders },
      { timeoutMs, retryable: true, userSignal },
    )

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new SandboxError("Download aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Download error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  }
}

/**
 * Consume an SSE stream from the exec/stream endpoint.
 *
 * Calls `onEvent` for each parsed event. Returns when the stream ends
 * (server sends `finished: true` or closes the connection).
 *
 * The timeout is an idle timeout — it resets each time a chunk is received,
 * so long-running commands won't spuriously abort.
 *
 * Not retried — POST is not idempotent.
 */
export async function streamSSE(opts: {
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs?: number
  signal?: AbortSignal
  onEvent: (event: ApiExecStreamEvent) => void
}): Promise<void> {
  const {
    url,
    headers,
    body,
    timeoutMs = 300_000,
    signal: userSignal,
    onEvent,
  } = opts
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const signal = composeSignals(controller.signal, userSignal)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const errorBody = await readErrorBody(res)
      throw mapApiError(res.status, errorBody)
    }

    if (!res.body) {
      throw new SandboxError("Expected streaming response but got empty body")
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Reset the idle timer on each chunk received
      if (timer) {
        clearTimeout(timer)
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const json = line.slice(6).trim()
        if (!json || json === "[DONE]") continue
        try {
          const event = JSON.parse(json) as ApiExecStreamEvent
          onEvent(event)
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      if (timedOut) throw new TimeoutError(`Stream timed out after ${timeoutMs}ms`)
      throw new SandboxError("Stream aborted", undefined, undefined, {
        cause: err,
      })
    }
    throw new SandboxError(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      { cause: err },
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}
