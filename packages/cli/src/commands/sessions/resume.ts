import { Command } from "commander"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { promptUser } from "../../utils/prompt"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createSpinner, type Spinner } from "../../utils/spinner"
import { streamEvents } from "../../utils/stream-events"

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
