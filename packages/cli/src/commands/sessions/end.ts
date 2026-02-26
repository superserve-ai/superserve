import { Command } from "commander"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"

export const endSession = new Command("end")
  .description("End an active session")
  .argument("<session-id>", "Session ID or short prefix")
  .action(
    withErrorHandler(async (sessionId: string) => {
      const client = createClient()
      const session = await client.endSession(sessionId)
      await track("cli_sessions_end")

      log.success(
        `Session ${sessionId} ended (status: ${(session.status ?? "?").toUpperCase()})`,
      )
    }),
  )
