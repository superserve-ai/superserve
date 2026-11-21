import {
  correlationId,
  createErrorCode,
  type CreateClientResult,
  type CreateMeasurement,
} from "./create-measurement"

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export const GOOGLE_SIGNUP_RECOVERY_URL = "/auth/signup?complete_google=1"

export function requiresGoogleSignupRecovery(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === "google_signup_recovery_required"
  )
}

/** A page of list results plus the total row count across all pages. */
export interface PagedResult<T> {
  items: T[]
  total: number
}

function getBaseUrl(): string {
  return "/api"
}

/**
 * The app is built with trailingSlash, so /api/foo answers only as
 * /api/foo/ — request that form directly instead of paying a 308 redirect
 * (a full extra round-trip) on every API call.
 */
function normalizePath(path: string): string {
  const queryStart = path.indexOf("?")
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart)
  const query = queryStart === -1 ? "" : path.slice(queryStart)
  return pathname.endsWith("/") ? path : `${pathname}/${query}`
}

/**
 * Runs a request against the console API proxy with a timeout (30s unless
 * given) and unified error handling, then hands the successful Response to `read`. The reader runs
 * inside the timeout window so a slow body read still aborts.
 */
async function request<R>(
  path: string,
  options: RequestInit,
  read: (response: Response) => Promise<R>,
  timeoutMs = 30_000,
  observeResponse?: (response: Response) => void,
): Promise<R> {
  const url = `${getBaseUrl()}${normalizePath(path)}`

  const headers = new Headers(options.headers)
  if (
    !headers.has("Content-Type") &&
    options.body &&
    typeof options.body === "string"
  ) {
    headers.set("Content-Type", "application/json")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    })
    observeResponse?.(response)

    if (!response.ok) {
      let code = "unknown_error"
      let message = response.statusText

      try {
        const body = await response.json()
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        // response body is not JSON, use defaults
      }

      if (
        code === "google_signup_recovery_required" &&
        typeof window !== "undefined"
      )
        window.location.assign(GOOGLE_SIGNUP_RECOVERY_URL)

      throw new ApiError(response.status, code, message)
    }

    return await read(response)
  } finally {
    clearTimeout(timeout)
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  return request(
    path,
    options,
    async (response) => {
      if (response.status === 204) {
        return undefined as T
      }
      return response.json() as Promise<T>
    },
    timeoutMs,
  )
}

export async function apiClientWithHeaders<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  return request(path, options, async (response) => ({
    data: (response.status === 204 ? undefined : await response.json()) as T,
    headers: response.headers,
  }))
}

/** Create-only observation leaves existing response and error values unchanged. */
export async function apiClientCreate<T>(
  options: RequestInit,
  measurement: CreateMeasurement,
): Promise<T> {
  const result: CreateClientResult = {
    outcome: "transport_unknown",
    request_dispatched: true,
    request_id: null,
    http_status: null,
    error_code: "unknown",
    sandbox_id: null,
  }
  const headers = new Headers(options.headers)
  const attemptId = correlationId(measurement.attemptId)
  if (attemptId) headers.set("X-Sandbox-Create-Attempt-ID", attemptId)
  try {
    const data = await request<T>(
      "/sandboxes",
      { ...options, headers },
      async (response) => {
        if (response.status === 204) return undefined as T
        return response.json() as Promise<T>
      },
      30_000,
      (response) => {
        result.http_status = response.status
        result.request_id = correlationId(response.headers.get("X-Request-ID"))
        result.outcome = response.ok ? "response_decode_unknown" : "http_error"
      },
    )
    const id =
      data && typeof data === "object" && "id" in data
        ? correlationId(data.id)
        : null
    if (result.http_status === 201 && id) {
      result.outcome = "http_success"
      result.sandbox_id = id
      result.error_code = null
    }
    return data
  } catch (error) {
    if (error instanceof ApiError)
      result.error_code = createErrorCode(error.code)
    throw error
  } finally {
    try {
      measurement.onResult(result)
    } catch {
      /* Telemetry cannot change Create. */
    }
  }
}

/**
 * Like `apiClient`, but for list endpoints: returns the parsed array plus the
 * total row count from the `X-Total-Count` header. Falls back to the page
 * length when the header is absent (e.g. an older API build without
 * pagination), so callers always get a usable `total`.
 */
export async function apiClientList<T>(
  path: string,
  options: RequestInit = {},
): Promise<PagedResult<T>> {
  return request(path, options, async (response) => {
    const items = (await response.json()) as T[]
    const header = response.headers.get("X-Total-Count")
    const parsed = header != null ? Number(header) : Number.NaN
    return {
      items,
      total: Number.isFinite(parsed) ? parsed : items.length,
    }
  })
}
