import { Command } from "commander"

import { createClient } from "../api/client"
import type { RunEvent } from "../api/types"
import { withErrorHandler } from "../errors"
import { formatDuration } from "../utils/format"
import { log } from "../utils/logger"
import { promptUser } from "../utils/prompt"
import { sanitizeTerminalOutput } from "../utils/sanitize"
import { createSpinner, type Spinner } from "../utils/spinner"

async function streamEvents(
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  for await (const event of events) {
    switch (event.type) {
      case "status":
      case "run.started":
      case "heartbeat":
        break
      case "message.delta": {
        spinner?.stop()
        process.stdout.write(sanitizeTerminalOutput(event.data.content ?? ""))
        break
      }
      case "run.completed": {
        spinner?.stop()
        const durationMs = event.data.duration_ms ?? 0
        console.log()
        console.error(`\nCompleted in ${formatDuration(durationMs)}`)
        return 0
      }
      case "run.failed": {
        spinner?.stop()
        const errorMsg =
          event.data.error?.message ?? "Execution failed"
        log.error(errorMsg)
        return 1
      }
      case "run.cancelled": {
        spinner?.stop()
        console.error("\nCancelled.")
        return 130
      }
    }
  }
  return 1
}

export const attach = new Command("attach")
  .description("Reconnect to a running session")
  .argument("<session-id>", "Session ID or short prefix")
  .action(
    withErrorHandler(async (sessionIdArg: string) => {
      const client = createClient()
      let spinner: Spinner | null = null

      // Resolve session ID (supports short prefixes)
      const session = await client.getSession(sessionIdArg)
      const sessionId = session.id

      if (session.status === "completed" || session.status === "failed") {
        log.error(
          `Session ${sessionIdArg} has already ${session.status}. Cannot attach.`,
        )
        process.exit(1)
      }

      // Determine if this is a Claude session based on agent name
      const isClaude = session.agent_name === "claude-code"

      console.error(`Attached to session ${sessionId}`)
      if (isClaude) {
        console.error("Type your prompt or 'exit' to disconnect.\n")
      }

      // Handle Ctrl+C
      process.on("SIGINT", () => {
        spinner?.stop()
        console.error(
          `\nDisconnected. Session ${sessionId} continues running.`,
        )
        process.exit(130)
      })

      const useSpinner = process.stderr.isTTY

      // Interactive loop
      while (true) {
        const prompt = await promptUser()
        if (
          !prompt ||
          !prompt.trim() ||
          prompt.trim().toLowerCase() === "exit"
        ) {
          break
        }

        if (useSpinner) {
          spinner = createSpinner({ showElapsed: true })
          spinner.start()
        }

        let exitCode: number
        if (isClaude) {
          exitCode = await streamEvents(
            client.streamClaudeMessage(sessionId, prompt),
            spinner,
          )
        } else {
          exitCode = await streamEvents(
            client.streamSessionMessage(sessionId, prompt),
            spinner,
          )
        }
        if (exitCode) process.exit(exitCode)
      }
    }),
  )
