import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { confirm } from "../../utils/prompt"

export const deleteVmCommand = new Command("delete")
  .description("Terminate and purge a VM (irreversible)")
  .argument("<vm_id>", "VM identifier")
  .option("-f, --force", "Skip confirmation")
  .action(
    withErrorHandler(async (vmId: string, options: { force?: boolean }) => {
      if (!options.force) {
        const ok = await confirm(
          `Delete VM ${pc.bold(vmId)}? This is irreversible.`,
        )
        if (!ok) {
          console.log("Cancelled.")
          return
        }
      }

      const client = createClient()
      await client.deleteVm(vmId)
      await track("cli_vm_delete")
      log.success(`VM ${pc.bold(vmId)} deleted.`)
    }),
  )
