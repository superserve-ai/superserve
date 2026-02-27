import pc from "picocolors"

const { bold, dim } = pc

import { Command } from "commander"
import terminalLink from "terminal-link"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatTimestamp } from "../../utils/format"
import { sanitizeTerminalOutput } from "../../utils/sanitize"
import { createTable } from "../../utils/table"
import { coloredStatus } from "./status"

export const getAgent = new Command("get")
  .description("Get details of a hosted agent")
  .argument("<name>", "Agent name or ID")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (name: string, options: { json?: boolean }) => {
      const client = createClient()
      const agent = await client.getAgent(name)
      await track("cli_agents_get", { agent_name: name })

      if (options.json) {
        console.log(JSON.stringify(agent, null, 2))
        return
      }

      const table = createTable([bold("Field"), bold("Value")])

      table.push(
        [bold("ID"), dim(agent.id)],
        [bold("Name"), sanitizeTerminalOutput(agent.name)],
        [bold("Status"), coloredStatus(agent.sandbox_status)],
        [
          bold("Command"),
          dim(sanitizeTerminalOutput(agent.command ?? "(none)")),
        ],
        [bold("Created"), dim(formatTimestamp(agent.created_at))],
        [bold("Updated"), dim(formatTimestamp(agent.updated_at))],
        [
          bold("Playground"),
          terminalLink(
            "Playground ↗",
            `https://playground.superserve.ai/agents/${agent.id}/`,
          ),
        ],
      )

      console.log(table.toString())
    }),
  )
