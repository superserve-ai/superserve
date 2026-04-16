/**
 * Typed error hierarchy for the Superserve SDK.
 *
 * Maps HTTP status codes to specific error classes so users can catch
 * granular errors without inspecting status codes.
 */

export class SandboxError extends Error {
  readonly statusCode?: number
  readonly code?: string

  constructor(message: string, statusCode?: number, code?: string) {
    super(message)
    this.name = "SandboxError"
    this.statusCode = statusCode
    this.code = code
  }
}

export class AuthenticationError extends SandboxError {
  constructor(message = "Missing or invalid API key") {
    super(message, 401)
    this.name = "AuthenticationError"
  }
}

export class ValidationError extends SandboxError {
  constructor(message: string) {
    super(message, 400)
    this.name = "ValidationError"
  }
}

export class NotFoundError extends SandboxError {
  constructor(message = "Resource not found") {
    super(message, 404)
    this.name = "NotFoundError"
  }
}

export class ConflictError extends SandboxError {
  constructor(message = "Sandbox is not in a valid state for this operation") {
    super(message, 409)
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
  constructor(message = "Internal server error") {
    super(message, 500)
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
      return new ValidationError(message)
    case 401:
      return new AuthenticationError(message)
    case 404:
      return new NotFoundError(message)
    case 409:
      return new ConflictError(message)
    default:
      if (status >= 500) return new ServerError(message)
      return new SandboxError(message, status, code)
  }
}
