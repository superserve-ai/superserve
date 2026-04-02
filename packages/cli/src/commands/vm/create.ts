import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { createSpinner } from "../../utils/spinner"
import { formatVmDetail } from "./format"

export const createVmCommand = new Command("create")
  .description("Create a VM from a base image")
  .requiredOption("--name <name>", "Name for the VM")
  .requiredOption("--image <image>", "Base image (e.g. ubuntu-22.04)")
  .option("--vcpu <count>", "Number of virtual CPUs", Number.parseInt)
  .option("--memory <mib>", "Memory in MiB", Number.parseInt)
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (options: {
        name: string
        image: string
        vcpu?: number
        memory?: number
        json?: boolean
      }) => {
        const client = createClient()
        const spinner = createSpinner()
        spinner.start("Creating VM...")

        const vm = await client.createVm({
          name: options.name,
          image: options.image,
          vcpu_count: options.vcpu,
          mem_size_mib: options.memory,
        })

        spinner.done()
        await track("cli_vm_create", { image: options.image })

        if (options.json) {
          console.log(JSON.stringify(vm, null, 2))
          return
        }

        log.success(`VM ${pc.bold(vm.name)} created (${pc.dim(vm.id)})`)
        console.log(formatVmDetail(vm))
      },
    ),
  )
