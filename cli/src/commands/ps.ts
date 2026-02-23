import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import { createClient } from "../api/client"
import type { SessionData } from "../api/types"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { formatTimestamp } from "../utils/format"
import { sanitizeTerminalOutput } from "../utils/sanitize"
import { createTable } from "../utils/table"
import { coloredSessionStatus } from "./sessions/status"

export const ps = new Command("ps")
  .description("List active sessions")
  .option("--all", "Show all sessions (including completed)")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (options: { all?: boolean; json?: boolean }) => {
        const client = createClient()
        const status = options.all ? undefined : "active"
        const sessions: SessionData[] = await client.listSessions(
          undefined,
          status,
        )

        // Also fetch idle sessions
        let idleSessions: SessionData[] = []
        if (!options.all) {
          idleSessions = await client.listSessions(undefined, "idle")
        }

        const sessionList = options.all
          ? sessions
          : [...sessions, ...idleSessions]

        if (options.json) {
          console.log(JSON.stringify(sessionList))
          return
        }

        if (sessionList.length === 0) {
          const msg = options.all
            ? "No sessions found."
            : "No active sessions."
          console.log(`${msg} Start one with:\n`)
          console.log(
            commandBox('superserve claude "fix the bug in auth.ts"'),
          )
          return
        }

        const table = createTable([
          bold("ID"),
          bold("Agent"),
          bold("Status"),
          bold("Msgs"),
          bold("Created"),
        ])

        for (const s of sessionList) {
          const sidClean = s.id.replace("ses_", "").replace(/-/g, "")
          const sidShort = sidClean.slice(0, 12)
          const agentDisplay = sanitizeTerminalOutput(
            s.agent_name ?? s.agent_id ?? "?",
          )

          table.push([
            sidShort,
            agentDisplay,
            coloredSessionStatus(s.status ?? "?"),
            String(s.message_count ?? 0),
            dim(formatTimestamp(s.created_at, true)),
          ])
        }

        console.log(table.toString())
      },
    ),
  )
