/**
 * Typed error hierarchy for the Superserve SDK.
 *
 * Maps HTTP status codes to specific error classes so users can catch
 * granular errors without inspecting status codes.
 */

export class SandboxError extends Error {
  readonly statusCode?: number
  readonly code?: string

  constructor(
    message: string,
    statusCode?: number,
    code?: string,
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = "SandboxError"
    this.statusCode = statusCode
    this.code = code
    if (options?.cause !== undefined) {
      // ES2022 `cause` — set directly to avoid requiring lib >= ES2022
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

export class AuthenticationError extends SandboxError {
  constructor(message = "Missing or invalid API key", code?: string) {
    super(message, 401, code)
    this.name = "AuthenticationError"
  }
}

export class ValidationError extends SandboxError {
  constructor(message: string, code?: string) {
    super(message, 400, code)
    this.name = "ValidationError"
  }
}

export class NotFoundError extends SandboxError {
  constructor(message = "Resource not found", code?: string) {
    super(message, 404, code)
    this.name = "NotFoundError"
  }
}

export class ConflictError extends SandboxError {
  constructor(
    message = "Sandbox is not in a valid state for this operation",
    code?: string,
  ) {
    super(message, 409, code)
    this.name = "ConflictError"
  }
}

export class TimeoutError extends SandboxError {
  constructor(message = "Request timed out") {
    super(message)
    this.name = "TimeoutError"
  }
}

export class ServerError extends SandboxError {
  constructor(message = "Internal server error", code?: string) {
    super(message, 500, code)
    this.name = "ServerError"
  }
}

/**
 * Map an HTTP status code and response body to a typed error.
 * @internal
 */
export function mapApiError(
  status: number,
  body: { error?: { code?: string; message?: string } },
): SandboxError {
  const message = body?.error?.message ?? `API error (${status})`
  const code = body?.error?.code

  switch (status) {
    case 400:
      return new ValidationError(message, code)
    case 401:
      return new AuthenticationError(message, code)
    case 404:
      return new NotFoundError(message, code)
    case 409:
      return new ConflictError(message, code)
    default:
      if (status >= 500) return new ServerError(message, code)
      return new SandboxError(message, status, code)
  }
}
