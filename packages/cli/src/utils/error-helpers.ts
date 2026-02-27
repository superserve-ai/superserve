/**
 * Enhanced error utilities for CLI with user-friendly messages
 */

import { PlatformAPIError } from "../api/errors"

/**
 * Get user-friendly error message with suggestions
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof PlatformAPIError) {
    const code = error.statusCode

    switch (code) {
      case 400:
        return "Invalid request. Please check your input and try again."
      case 401:
        return "Authentication failed. Please run 'superserve login' to authenticate."
      case 403:
        return "Permission denied. You don't have access to this resource."
      case 404:
        return "Resource not found. Please check the name/ID and try again."
      case 408:
        return "Request timeout. The server took too long to respond. Please try again."
      case 429:
        return "Rate limited. Please wait a moment before trying again."
      case 500:
      case 502:
      case 503:
      case 504:
        return "Server error. Please try again later or contact support."
      case 0:
        return "Network error. Please check your internet connection."
      default:
        return `API Error (${code}): ${error.message}`
    }
  }

  if (error instanceof Error) {
    if (error.message.includes("ENOENT")) {
      return "File or directory not found. Please check the path and try again."
    }
    if (error.message.includes("EACCES")) {
      return "Permission denied. Check file permissions and try again."
    }
    if (error.message.includes("timeout")) {
      return "Operation timed out. Please try again."
    }
    if (error.message.includes("network")) {
      return "Network error. Check your connection and try again."
    }
    return error.message
  }

  return "An unexpected error occurred. Please try again."
}

/**
 * Suggest commands based on error context
 */
export function getSuggestion(error: unknown, context?: string): string | null {
  if (error instanceof PlatformAPIError) {
    if (error.statusCode === 401) {
      return "Try running: superserve login"
    }
    if (error.statusCode === 404 && context?.includes("agent")) {
      return "Try running: superserve agents list (to see available agents)"
    }
    if (error.statusCode === 429) {
      return "Wait a moment and try again."
    }
  }

  if (error instanceof Error) {
    if (error.message.includes("superserve.yaml")) {
      return "Try running: superserve init (to create superserve.yaml)"
    }
    if (error.message.includes("API key")) {
      return "Try running: superserve login"
    }
  }

  return null
}

/**
 * Format error for display with optional suggestions
 */
export function formatError(error: unknown, context?: string): string {
  const message = getErrorMessage(error)
  const suggestion = getSuggestion(error, context)

  if (suggestion) {
    return `${message}\n\n💡 Suggestion: ${suggestion}`
  }

  return message
}

/**
 * Handle common CLI errors
 */
export function handleCliError(error: unknown, context?: string): never {
  const formatted = formatError(error, context)
  console.error(`\n❌ Error: ${formatted}\n`)
  process.exit(1)
}

/**
 * Validate required configuration
 */
export function validateConfiguration(config: any): void {
  if (!config.name) {
    throw new Error("Missing 'name' in superserve.yaml")
  }
  if (!config.command) {
    throw new Error("Missing 'command' in superserve.yaml")
  }
}

/**
 * Warn about deprecated commands or options
 */
export function warnDeprecated(oldName: string, newName: string): void {
  console.warn(
    `\n⚠️  Warning: '${oldName}' is deprecated. Use '${newName}' instead.\n`,
  )
}

/**
 * Show helpful tips
 */
export function showTip(tip: string): void {
  console.log(`\n💡 Tip: ${tip}\n`)
}
