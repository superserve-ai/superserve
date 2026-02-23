import { Command } from "commander"
import { createClient } from "../api/client"
import { withErrorHandler } from "../errors"
import { log } from "../utils/logger"

export const stop = new Command("stop")
  .description("Stop a running session")
  .argument("<session-id>", "Session ID or short prefix")
  .action(
    withErrorHandler(async (sessionIdArg: string) => {
      const client = createClient()
      const session = await client.endSession(sessionIdArg)
      log.success(`Session ${session.id} stopped.`)
    }),
  )
