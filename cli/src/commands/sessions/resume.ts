import { Command } from "commander"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import type { RunEvent } from "../../api/types"
import { withErrorHandler } from "../../errors"
import { formatDuration } from "../../utils/format"
import { log } from "../../utils/logger"
import { promptUser } from "../../utils/prompt"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createSpinner, type Spinner } from "../../utils/spinner"

async function streamEvents(
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

export const resumeSession = new Command("resume")
  .description("Resume a previous session")
  .argument("<session-id>", "Session ID or short prefix")
  .action(
    withErrorHandler(async (sessionId: string) => {
      const client = createClient()
      let spinner: Spinner | null = null
      const useSpinner = process.stderr.isTTY

      // Handle Ctrl+C
      const ac = new AbortController()
      const onSigint = () => {
        spinner?.stop()
        console.error("\nCancelled.")
        ac.abort()
        process.exitCode = 130
      }
      process.on("SIGINT", onSigint)
      ac.signal.addEventListener("abort", () => {
        process.off("SIGINT", onSigint)
      })

      try {
        const session = await client.resumeSession(sessionId)

        const title = sanitizeTerminalOutput(session.title || "Untitled")
        const agentName = sanitizeTerminalOutput(
          session.agent_name ?? session.agent_id ?? "?",
        )
        console.error(`Resumed: "${title}" (${agentName})`)

        const fullSessionId = session.id

        await track("cli_sessions_resume", { agent_name: agentName })

        let messageCount = 0
        while (true) {
          const prompt = await promptUser()
          if (
            !prompt ||
            !prompt.trim() ||
            prompt.trim().toLowerCase() === "exit"
          ) {
            break
          }

          messageCount++
          if (useSpinner) {
            spinner = createSpinner({ showElapsed: true })
            spinner.start()
          }

          const exitCode = await streamEvents(
            client.streamSessionMessage(fullSessionId, prompt),
            spinner,
          )
          if (exitCode) {
            process.exitCode = exitCode
            return
          }
        }

        await track("cli_sessions_resume_completed", {
          agent_name: agentName,
          messages: messageCount,
        })
      } finally {
        spinner?.stop()
        process.off("SIGINT", onSigint)
      }
    }),
  )
