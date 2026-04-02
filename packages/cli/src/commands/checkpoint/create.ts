import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatSize, formatTimestamp } from "../../utils/format"
import { log } from "../../utils/logger"
import { createSpinner } from "../../utils/spinner"

export const createCheckpointCommand = new Command("create")
  .description("Create a named checkpoint of a VM")
  .argument("<vm_id>", "VM identifier")
  .requiredOption("--name <name>", "Name for the checkpoint")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (vmId: string, options: { name: string; json?: boolean }) => {
        const client = createClient()
        const spinner = createSpinner()
        spinner.start("Creating checkpoint...")

        const cp = await client.createCheckpoint(vmId, {
          name: options.name,
        })

        spinner.done()
        await track("cli_checkpoint_create")

        if (options.json) {
          console.log(JSON.stringify(cp, null, 2))
          return
        }

        log.success(
          `Checkpoint ${pc.bold(cp.name ?? cp.id)} created (${formatSize(cp.size_bytes)})`,
        )
        console.log(`  ID:      ${pc.dim(cp.id)}`)
        console.log(`  Size:    ${formatSize(cp.size_bytes)}`)
        console.log(`  Delta:   ${formatSize(cp.delta_size_bytes)}`)
        console.log(`  Created: ${formatTimestamp(cp.created_at, true)}`)
      },
    ),
  )
