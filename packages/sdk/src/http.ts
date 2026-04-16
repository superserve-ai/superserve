/**
 * Minimal HTTP client wrapping native `fetch`.
 *
 * Handles:
 * - Auth header injection (`X-API-Key`)
 * - JSON request/response serialization
 * - Error mapping to typed SDK errors
 * - Request timeout via AbortController
 * - SSE stream parsing for exec/stream endpoint
 */

import { mapApiError, SandboxError, TimeoutError } from "./errors.js"
import type { ApiExecStreamEvent } from "./types.js"

const DEFAULT_TIMEOUT_MS = 30_000

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

/**
 * Make an HTTP request and return parsed JSON.
 *
 * Throws typed SandboxError subclasses on non-2xx responses.
 */
export async function request<T>(opts: RequestOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
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
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
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
 */
export async function uploadBytes(opts: {
  url: string
  headers: Record<string, string>
  body: BodyInit
  timeoutMs?: number
}): Promise<void> {
  const { url, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        ...headers,
      },
      body,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Upload timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Upload error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download raw bytes from a URL. Used for file download from the data plane.
 */
export async function downloadBytes(opts: {
  url: string
  headers: Record<string, string>
  timeoutMs?: number
}): Promise<Uint8Array> {
  const { url, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
      throw mapApiError(res.status, errorBody)
    }

    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof SandboxError) throw err
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(`Download timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Download error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Consume an SSE stream from the exec/stream endpoint.
 *
 * Calls `onEvent` for each parsed event. Returns when the stream ends
 * (server sends `finished: true` or closes the connection).
 */
export async function streamSSE(opts: {
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs?: number
  onEvent: (event: ApiExecStreamEvent) => void
}): Promise<void> {
  const { url, headers, body, timeoutMs = 300_000, onEvent } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errorBody: { error?: { code?: string; message?: string } }
      try {
        errorBody = await res.json()
      } catch {
        errorBody = {}
      }
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
      throw new TimeoutError(`Stream timed out after ${timeoutMs}ms`)
    }
    throw new SandboxError(
      `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}
