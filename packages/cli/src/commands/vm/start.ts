import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { coloredStatus } from "./format"

export const startVmCommand = new Command("start")
  .description("Start a stopped VM")
  .argument("<vm_id>", "VM identifier")
  .action(
    withErrorHandler(async (vmId: string) => {
      const client = createClient()
      const vm = await client.startVm(vmId)
      await track("cli_vm_start")
      log.success(`VM ${pc.bold(vm.name)} is now ${coloredStatus(vm.status)}.`)
    }),
  )
