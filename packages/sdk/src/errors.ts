export class SuperserveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SuperserveError"
  }
}

export class APIError extends SuperserveError {
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "APIError"
    this.status = status
    this.details = details ?? {}
  }
}
