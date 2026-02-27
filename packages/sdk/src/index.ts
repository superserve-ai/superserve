/**
 * @file Superserve SDK
 * @description TypeScript SDK for deploying and interacting with AI agents in sandboxed cloud containers.
 *
 * @example
 * ```typescript
 * import Superserve from '@superserve/sdk'
 *
 * const client = new Superserve({ apiKey: 'your-api-key' })
 *
 * // One-shot request
 * const result = await client.run('my-agent', {
 *   message: 'What is 2 + 2?'
 * })
 * console.log(result.text)
 *
 * // Streaming response
 * const stream = client.stream('my-agent', {
 *   message: 'Write a poem',
 *   onText: (chunk) => process.stdout.write(chunk)
 * })
 * await stream.consume()
 * ```
 */

/**
 * Main Superserve client class
 * @see {@link Superserve}
 */
export { Superserve } from "./client"

/**
 * Default export of Superserve client
 */
export { Superserve as default } from "./client"

/**
 * Multi-turn session class for managing conversation state
 * @see {@link Session}
 */
export { Session } from "./session"

/**
 * Async iterable stream of agent events
 * @see {@link AgentStream}
 */
export { AgentStream } from "./stream"

/**
 * Error classes for error handling
 * @see {@link SuperserveError}
 * @see {@link APIError}
 */
export { SuperserveError, APIError } from "./errors"

/**
 * Enhanced error handling utilities
 * @see {@link retryWithBackoff}
 * @see {@link isRetryableError}
 * @see {@link getUserFriendlyErrorMessage}
 */
export {
  retryWithBackoff,
  isRetryableError,
  calculateBackoffDelay,
  getUserFriendlyErrorMessage,
  ContextualError,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from "./error-handling"

/**
 * Structured logging utilities
 * @see {@link ConsoleLogger}
 * @see {@link JSONLogger}
 * @see {@link getLogger}
 * @see {@link setLogger}
 */
export {
  getLogger,
  setLogger,
  configureProductionLogging,
  configureDevelopmentLogging,
  ConsoleLogger,
  JSONLogger,
  LogLevel,
  type LogEntry,
  type ILogger,
} from "./logger"

/**
 * Input validation utilities
 * @see {@link validateNonEmpty}
 * @see {@link validateUrl}
 * @see {@link validateSuperserveOptions}
 * @see {@link validateRunOptions}
 */
export {
  ValidationError,
  validateNonEmpty,
  validateUrl,
  validateNumberInRange,
  validateSuperserveOptions,
  validateRunOptions,
  validateEnvironmentVariables,
  validateFilePath,
  type SuperserveOptionsValidation,
  type RunOptionsValidation,
} from "./validation"

// ===================== Type Exports =====================

/**
 * Options for creating a Superserve client
 * @typedef {Object} SuperserveOptions
 * @property {string} apiKey - Your Superserve API key (required)
 * @property {string} [baseUrl] - Custom API endpoint (optional, defaults to https://api.superserve.ai)
 * @property {number} [timeout] - Request timeout in milliseconds (optional, defaults to 30000)
 */
export type {
  SuperserveOptions,
  RunOptions,
  StreamOptions,
  SessionOptions,
  RunResult,
  ToolCall,
  StreamEvent,
  TextEvent,
  ToolStartEvent,
  ToolEndEvent,
  RunCompletedEvent,
  RunFailedEvent,
  Agent,
  SessionInfo,
} from "./types"
