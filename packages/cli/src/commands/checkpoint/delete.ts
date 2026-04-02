import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { confirm } from "../../utils/prompt"

export const deleteCheckpointCommand = new Command("delete")
  .description("Delete a checkpoint")
  .argument("<vm_id>", "VM identifier")
  .argument("<checkpoint_id>", "Checkpoint identifier")
  .option("-f, --force", "Delete even if pinned, skip confirmation")
  .action(
    withErrorHandler(
      async (
        vmId: string,
        checkpointId: string,
        options: { force?: boolean },
      ) => {
        if (!options.force) {
          const ok = await confirm(
            `Delete checkpoint ${pc.bold(checkpointId)}?`,
          )
          if (!ok) {
            console.log("Cancelled.")
            return
          }
        }

        const client = createClient()
        await client.deleteCheckpoint(vmId, checkpointId, !!options.force)
        await track("cli_checkpoint_delete")
        log.success(`Checkpoint ${pc.bold(checkpointId)} deleted.`)
      },
    ),
  )
