import { Command } from "commander"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatVmDetail } from "./format"

export const getVmCommand = new Command("get")
  .description("Get VM details")
  .argument("<vm_id>", "VM identifier")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (vmId: string, options: { json?: boolean }) => {
      const client = createClient()
      const vm = await client.getVm(vmId)
      await track("cli_vm_get")

      if (options.json) {
        console.log(JSON.stringify(vm, null, 2))
        return
      }

      console.log(formatVmDetail(vm))
    }),
  )
