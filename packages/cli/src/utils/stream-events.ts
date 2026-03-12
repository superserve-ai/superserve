import { PlatformAPIError } from "../api/errors"
import type { SuperserveClient } from "../api/client"
import type { RunEvent } from "../api/types"
import { formatDuration } from "./format"
import { log } from "./logger"
import { sanitizeTerminalOutput } from "./sanitize"
import type { Spinner } from "./spinner"

const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY = 2.0 // seconds
const RECONNECT_MAX_DELAY = 30.0 // seconds

function isConnectionError(error: unknown): boolean {
  if (error instanceof PlatformAPIError) return false
  if (error instanceof TypeError) {
    const msg = (error as TypeError).message
    return msg.includes("fetch") || msg.includes("connect")
  }
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.includes("network") ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("socket hang up"))
  )
}

function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY * 2 ** (attempt - 1), RECONNECT_MAX_DELAY)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function streamEvents(
  client: SuperserveClient,
  sessionId: string,
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  let lastSequence = 0
  let reconnectAttempts = 0
  let agentPrefixShown = false
  let contentOnCurrentLine = false
  let eventIter = events

  while (true) {
    try {
      for await (const event of eventIter) {
        reconnectAttempts = 0
        lastSequence++

        switch (event.type) {
          case "status":
          case "run.started":
          case "heartbeat":
            break
          case "message.delta": {
            spinner?.stop()
            if (!agentPrefixShown) {
              process.stdout.write("Agent> ")
              agentPrefixShown = true
            }
            const content = sanitizeTerminalOutput(event.data.content ?? "")
            process.stdout.write(content)
            contentOnCurrentLine = !content.endsWith("\n")
            break
          }
          case "tool.start": {
            spinner?.stop()
            if (contentOnCurrentLine) {
              process.stdout.write("\n")
              contentOnCurrentLine = false
            }
            const tool = event.data.tool ?? "unknown"
            const raw = event.data.input ?? {}
            const toolInput =
              typeof raw === "string" ? raw : JSON.stringify(raw)
            const inputStr = sanitizeTerminalOutput(toolInput)
            const inputPreview =
              inputStr.length > 50 ? `${inputStr.slice(0, 50)}...` : inputStr
            process.stderr.write(`\n[${tool}] ${inputPreview}`)
            break
          }
          case "tool.end": {
            process.stderr.write(
              ` (${formatDuration(event.data.duration_ms ?? 0)})\n`,
            )
            spinner?.start()
            break
          }
          case "run.completed": {
            spinner?.stop()
            const durationMs = event.data.duration_ms ?? 0
            console.log()
            log.success(`Completed in ${formatDuration(durationMs)}`)
            if (event.data.max_turns_reached) {
              const msg = sanitizeTerminalOutput(
                event.data.max_turns_message ?? "Max turns reached.",
              )
              console.error(`\nWarning: ${msg}`)
            }
            return 0
          }
          case "run.failed": {
            spinner?.stop()
            const error = event.data.error
            const message = error?.message
              ? sanitizeTerminalOutput(error.message)
              : null
            if (message) {
              log.error(message)
            } else {
              log.error(
                "Something went wrong while running the agent. Please try again later.",
              )
            }
            return 1
          }
          case "run.cancelled": {
            spinner?.stop()
            console.error("\nRun was cancelled.")
            return 130
          }
        }
      }

      // Iterator exhausted without a terminal event
      spinner?.stop()
      console.error("\nWarning: Stream ended unexpectedly.")
      return 1
    } catch (error) {
      if (!isConnectionError(error)) throw error

      reconnectAttempts++
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        spinner?.stop()
        log.error("Lost connection to server after multiple retries.")
        return 1
      }

      const delay = reconnectDelay(reconnectAttempts)
      if (spinner) {
        spinner.update(
          `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
        )
      } else {
        process.stderr.write(
          `\nReconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\n`,
        )
      }

      await sleep(delay * 1000)

      try {
        eventIter = client.streamSessionEvents(sessionId, lastSequence)
      } catch (reconnectError) {
        if (
          reconnectError instanceof PlatformAPIError &&
          reconnectError.statusCode >= 400 &&
          reconnectError.statusCode < 500
        ) {
          spinner?.stop()
          log.error(`Reconnection failed: ${reconnectError.message}`)
          return 1
        }
        // Server error or network issue — will retry on next loop iteration
        continue
      }
    }
  }
}

export async function streamEventsJson(
  client: SuperserveClient,
  sessionId: string,
  eventIter: AsyncIterableIterator<RunEvent>,
): Promise<number> {
  let lastSequence = 0
  let reconnectAttempts = 0
  let iter = eventIter

  while (true) {
    try {
      for await (const event of iter) {
        reconnectAttempts = 0
        lastSequence++

        console.log(JSON.stringify({ type: event.type, data: event.data }))
        if (event.type === "run.completed") return 0
        if (event.type === "run.failed") return 1
        if (event.type === "run.cancelled") return 130
      }
      return 1
    } catch (error) {
      if (!isConnectionError(error)) throw error

      reconnectAttempts++
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error(
          "Error: Lost connection to server after multiple retries.",
        )
        return 1
      }

      const delay = reconnectDelay(reconnectAttempts)
      console.error(
        `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
      )

      await sleep(delay * 1000)

      try {
        iter = client.streamSessionEvents(sessionId, lastSequence)
      } catch (reconnectError) {
        if (
          reconnectError instanceof PlatformAPIError &&
          reconnectError.statusCode >= 400 &&
          reconnectError.statusCode < 500
        ) {
          console.error(`Error: Reconnection failed: ${(reconnectError as PlatformAPIError).message}`)
          return 1
        }
        continue
      }
    }
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
