import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatSize, formatTimestamp } from "../../utils/format"
import { createTable } from "../../utils/table"

export const listCheckpointsCommand = new Command("list")
  .description("List checkpoints for a VM")
  .argument("<vm_id>", "VM identifier")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (vmId: string, options: { json?: boolean }) => {
      const client = createClient()
      const checkpoints = await client.listCheckpoints(vmId)
      await track("cli_checkpoint_list", { count: checkpoints.length })

      if (options.json) {
        console.log(JSON.stringify(checkpoints, null, 2))
        return
      }

      if (checkpoints.length === 0) {
        console.log("No checkpoints found for this VM.")
        return
      }

      const table = createTable([
        pc.bold("ID"),
        pc.bold("Name"),
        pc.bold("Type"),
        pc.bold("Size"),
        pc.bold("Delta"),
        pc.bold("Created"),
        pc.bold("Pinned"),
      ])

      for (const cp of checkpoints) {
        table.push([
          pc.dim(cp.id),
          cp.name ?? pc.dim("—"),
          cp.type,
          formatSize(cp.size_bytes),
          formatSize(cp.delta_size_bytes),
          pc.dim(formatTimestamp(cp.created_at, true)),
          cp.pinned ? pc.green("yes") : pc.dim("no"),
        ])
      }

      console.log(table.toString())
    }),
  )
