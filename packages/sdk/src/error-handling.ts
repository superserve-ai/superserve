import { APIError, SuperserveError } from "./errors"

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterFactor: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof APIError) {
    // Retry on 5xx errors and specific 4xx errors
    return (
      error.status >= 500 || // Server errors
      error.status === 408 || // Request timeout
      error.status === 429 // Too many requests
    )
  }

  if (error instanceof SuperserveError) {
    // Retry on network errors and timeouts
    const message = error.message.toLowerCase()
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("abort")
    )
  }

  return false
}

/**
 * Calculate delay for exponential backoff with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const exponentialDelay = Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs,
  )

  // Add random jitter
  const jitter = exponentialDelay * config.jitterFactor
  const jitterAmount = Math.random() * jitter * 2 - jitter
  return Math.max(0, exponentialDelay + jitterAmount)
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: unknown

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isRetryableError(error) || attempt === fullConfig.maxRetries) {
        throw error
      }

      const delay = calculateBackoffDelay(attempt, fullConfig)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * User-friendly error message generator
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    switch (error.status) {
      case 400:
        return "Invalid request. Please check your input and try again."
      case 401:
        return "Authentication failed. Please check your API key and try again."
      case 403:
        return "You don't have permission to access this resource."
      case 404:
        return "The requested resource was not found."
      case 408:
        return "Request timeout. Please try again."
      case 429:
        return "Too many requests. Please wait before trying again."
      case 500:
      case 502:
      case 503:
      case 504:
        return "Server error. Please try again later."
      default:
        return `API error (${error.status}): ${error.message}`
    }
  }

  if (error instanceof SuperserveError) {
    if (error.message.includes("timeout")) {
      return "Request timed out. Please check your connection and try again."
    }
    if (error.message.includes("network")) {
      return "Network error. Please check your connection and try again."
    }
    if (error.message.includes("abort")) {
      return "Request was cancelled. Please try again."
    }
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unknown error occurred. Please try again."
}

/**
 * Enhanced error class with context
 */
export class ContextualError extends SuperserveError {
  constructor(
    message: string,
    public readonly originalError: unknown,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "ContextualError"
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      originalError:
        this.originalError instanceof Error
          ? {
              name: this.originalError.name,
              message: this.originalError.message,
            }
          : this.originalError,
    }
  }
}
