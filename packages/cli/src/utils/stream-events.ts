import type { RunEvent } from "../api/types"
import { formatDuration } from "./format"
import { log } from "./logger"
import { sanitizeTerminalOutput } from "./sanitize"
import type { Spinner } from "./spinner"

export async function streamEvents(
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  let agentPrefixShown = false
  let contentOnCurrentLine = false

  for await (const event of events) {
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
        const toolInput = typeof raw === "string" ? raw : JSON.stringify(raw)
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

  return 1
}

export async function streamEventsJson(
  eventIter: AsyncIterableIterator<RunEvent>,
): Promise<number> {
  for await (const event of eventIter) {
    console.log(JSON.stringify({ type: event.type, data: event.data }))
    if (event.type === "run.completed") return 0
    if (event.type === "run.failed") return 1
    if (event.type === "run.cancelled") return 130
  }
  return 1
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
