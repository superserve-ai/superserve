import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import type { SessionData } from "../../api/types"
import { withErrorHandler } from "../../errors"
import { commandBox } from "../../utils/command-box"
import { formatRelativeTime } from "../../utils/format"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { truncate } from "../../utils/stream-events"
import { createTable } from "../../utils/table"
import { coloredSessionStatus } from "./status"

export const listSessions = new Command("list")
  .description("List sessions")
  .option("--agent <name>", "Filter by agent name or ID")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (options: { agent?: string; status?: string; json?: boolean }) => {
        const client = createClient()
        const sessionList: SessionData[] = await client.listSessions(
          options.agent,
          options.status,
        )
        await track("cli_sessions_list", { count: sessionList.length })

        if (options.json) {
          console.log(JSON.stringify(sessionList, null, 2))
          return
        }

        if (sessionList.length === 0) {
          console.log("No sessions found. Start one with:\n")
          console.log(commandBox('superserve run <agent> "your prompt"'))
          return
        }

        const headers = options.agent
          ? [
              bold("ID"),
              bold("Title"),
              bold("Status"),
              bold("Msgs"),
              bold("Last Active"),
            ]
          : [
              bold("ID"),
              bold("Agent"),
              bold("Title"),
              bold("Status"),
              bold("Msgs"),
              bold("Last Active"),
            ]

        const table = createTable(headers)

        for (const s of sessionList) {
          const sidClean = s.id.replace("ses_", "").replace(/-/g, "")
          const sidShort = sidClean.slice(0, 12)

          const title = truncate(sanitizeTerminalOutput(s.title ?? ""), 24)

          const lastActive = dim(
            formatRelativeTime(s.last_activity_at ?? s.created_at),
          )

          if (options.agent) {
            table.push([
              sidShort,
              title,
              coloredSessionStatus(s.status ?? "?"),
              String(s.message_count ?? 0),
              lastActive,
            ])
          } else {
            const agentDisplay = truncate(
              sanitizeTerminalOutput(s.agent_name ?? s.agent_id ?? "?"),
              16,
            )

            table.push([
              sidShort,
              agentDisplay,
              title,
              coloredSessionStatus(s.status ?? "?"),
              String(s.message_count ?? 0),
              lastActive,
            ])
          }
        }

        console.log(table.toString())
      },
    ),
  )
