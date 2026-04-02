import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { coloredStatus } from "./format"

export const stopVmCommand = new Command("stop")
  .description("Gracefully shut down a running VM")
  .argument("<vm_id>", "VM identifier")
  .action(
    withErrorHandler(async (vmId: string) => {
      const client = createClient()
      const vm = await client.stopVm(vmId)
      await track("cli_vm_stop")
      log.success(`VM ${pc.bold(vm.name)} is now ${coloredStatus(vm.status)}.`)
    }),
  )
