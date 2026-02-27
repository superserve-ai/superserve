import { SuperserveError } from "./errors"

/**
 * Validation error
 */
export class ValidationError extends SuperserveError {
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Validation failed for field '${field}': ${reason}`)
    this.name = "ValidationError"
  }
}

/**
 * Validates a string is not empty
 */
export function validateNonEmpty(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(fieldName, "must be a non-empty string")
  }
}

/**
 * Validates a string is a valid URL
 */
export function validateUrl(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string") {
    throw new ValidationError(fieldName, "must be a string")
  }

  try {
    new URL(value)
  } catch {
    throw new ValidationError(fieldName, "must be a valid URL")
  }
}

/**
 * Validates a number is within range
 */
export function validateNumberInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== "number") {
    throw new ValidationError(fieldName, "must be a number")
  }

  if (value < min || value > max) {
    throw new ValidationError(
      fieldName,
      `must be between ${min} and ${max}`,
    )
  }
}

/**
 * Validates options object
 */
export interface SuperserveOptionsValidation {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

export function validateSuperserveOptions(
  options: unknown,
): SuperserveOptionsValidation {
  if (typeof options !== "object" || options === null) {
    throw new ValidationError("options", "must be an object")
  }

  const opts = options as Record<string, unknown>

  if (!opts.apiKey) {
    throw new ValidationError("apiKey", "is required")
  }

  validateNonEmpty(opts.apiKey, "apiKey")

  if (opts.baseUrl !== undefined) {
    validateUrl(opts.baseUrl, "baseUrl")
  }

  if (opts.timeout !== undefined) {
    validateNumberInRange(opts.timeout, "timeout", 1, 600000)
  }

  return opts as SuperserveOptionsValidation
}

/**
 * Validates run options
 */
export interface RunOptionsValidation {
  message: string
  sessionId?: string
  idleTimeout?: number
}

export function validateRunOptions(
  options: unknown,
): RunOptionsValidation {
  if (typeof options !== "object" || options === null) {
    throw new ValidationError("options", "must be an object")
  }

  const opts = options as Record<string, unknown>

  if (!opts.message) {
    throw new ValidationError("message", "is required")
  }

  validateNonEmpty(opts.message, "message")

  if (opts.sessionId !== undefined) {
    validateNonEmpty(opts.sessionId, "sessionId")
  }

  if (opts.idleTimeout !== undefined) {
    validateNumberInRange(opts.idleTimeout, "idleTimeout", 60, 86400)
  }

  return opts as RunOptionsValidation
}

/**
 * Environment variable validation
 */
export function validateEnvironmentVariables(required: string[]): void {
  const missing: string[] = []

  for (const varName of required) {
    const value =
      typeof process !== "undefined"
        ? process.env[varName]
        : undefined

    if (!value) {
      missing.push(varName)
    }
  }

  if (missing.length > 0) {
    throw new SuperserveError(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Please set them and try again.`,
    )
  }
}

/**
 * File path validation
 */
export function validateFilePath(path: unknown, fieldName: string): asserts path is string {
  if (typeof path !== "string") {
    throw new ValidationError(fieldName, "must be a string")
  }

  // Prevent path traversal attacks
  if (path.includes("..")) {
    throw new ValidationError(fieldName, "path traversal is not allowed")
  }

  if (path.length === 0) {
    throw new ValidationError(fieldName, "must not be empty")
  }
}
