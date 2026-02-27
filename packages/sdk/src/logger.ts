/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string
  level: string
  message: string
  context?: Record<string, unknown>
  error?: {
    name: string
    message: string
    stack?: string
  }
}

/**
 * Logger interface
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void
  setLevel(level: LogLevel): void
}

/**
 * Default console logger implementation
 */
export class ConsoleLogger implements ILogger {
  private level: LogLevel = LogLevel.INFO
  private isDebugMode = typeof process !== "undefined" && process.env.DEBUG === "superserve:*"

  constructor() {
    if (this.isDebugMode) {
      this.level = LogLevel.DEBUG
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      const entry = this.createLogEntry("DEBUG", message, context)
      console.debug(`[${entry.timestamp}] [DEBUG]`, message, context || "")
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      const entry = this.createLogEntry("INFO", message, context)
      console.log(`[${entry.timestamp}] [INFO]`, message, context || "")
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.WARN) {
      const entry = this.createLogEntry("WARN", message, context)
      console.warn(`[${entry.timestamp}] [WARN]`, message, context || "")
    }
  }

  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    if (this.level <= LogLevel.ERROR) {
      let errorInfo: LogEntry["error"] | undefined
      if (error instanceof Error) {
        errorInfo = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      }

      const entry = this.createLogEntry("ERROR", message, context, errorInfo)
      console.error(
        `[${entry.timestamp}] [ERROR]`,
        message,
        error || "",
        context || "",
      )
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  private createLogEntry(
    level: string,
    message: string,
    context?: Record<string, unknown>,
    error?: LogEntry["error"],
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
    }
  }
}

/**
 * JSON logger for production
 */
export class JSONLogger implements ILogger {
  private level: LogLevel = LogLevel.INFO
  private isDebugMode = typeof process !== "undefined" && process.env.DEBUG === "superserve:*"

  constructor() {
    if (this.isDebugMode) {
      this.level = LogLevel.DEBUG
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      this.writeLog("DEBUG", message, context)
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      this.writeLog("INFO", message, context)
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.WARN) {
      this.writeLog("WARN", message, context)
    }
  }

  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    if (this.level <= LogLevel.ERROR) {
      let errorInfo: LogEntry["error"] | undefined
      if (error instanceof Error) {
        errorInfo = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      }

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "ERROR",
        message,
        context,
        error: errorInfo,
      }
      console.error(JSON.stringify(entry))
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  private writeLog(
    level: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    }
    console.log(JSON.stringify(entry))
  }
}

// Global logger instance
let globalLogger: ILogger = new ConsoleLogger()

/**
 * Get the global logger
 */
export function getLogger(): ILogger {
  return globalLogger
}

/**
 * Set the global logger
 */
export function setLogger(logger: ILogger): void {
  globalLogger = logger
}

/**
 * Configure logger for production (JSON format)
 */
export function configureProductionLogging(): void {
  setLogger(new JSONLogger())
}

/**
 * Configure logger for development (console format)
 */
export function configureDevelopmentLogging(): void {
  setLogger(new ConsoleLogger())
}
