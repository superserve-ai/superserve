import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { coloredStatus } from "./format"

export const wakeVmCommand = new Command("wake")
  .description("Restore a sleeping VM from its snapshot")
  .argument("<vm_id>", "VM identifier")
  .action(
    withErrorHandler(async (vmId: string) => {
      const client = createClient()
      const vm = await client.wakeVm(vmId)
      await track("cli_vm_wake")
      log.success(`VM ${pc.bold(vm.name)} is now ${coloredStatus(vm.status)}.`)
    }),
  )
