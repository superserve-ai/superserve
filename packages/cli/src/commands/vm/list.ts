import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { commandBox } from "../../utils/command-box"
import { formatElapsed, formatTimestamp } from "../../utils/format"
import { createTable } from "../../utils/table"
import { coloredStatus } from "./format"

export const listVmsCommand = new Command("list")
  .description("List all VMs")
  .option("--status <status>", "Filter by VM status (RUNNING, STOPPED, etc.)")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (options: { status?: string; json?: boolean }) => {
      const client = createClient()
      const vms = await client.listVms(options.status?.toUpperCase())
      await track("cli_vm_list", { count: vms.length })

      if (options.json) {
        console.log(JSON.stringify(vms, null, 2))
        return
      }

      if (vms.length === 0) {
        console.log("No VMs found. Create one with:\n")
        console.log(
          commandBox("superserve vm create --name my-vm --image ubuntu-22.04"),
        )
        return
      }

      const table = createTable([
        pc.bold("Name"),
        pc.bold("ID"),
        pc.bold("Status"),
        pc.bold("vCPU"),
        pc.bold("Memory"),
        pc.bold("IP"),
        pc.bold("Uptime"),
        pc.bold("Created"),
      ])

      for (const vm of vms) {
        table.push([
          vm.name,
          pc.dim(vm.id),
          coloredStatus(vm.status),
          String(vm.vcpu_count),
          `${vm.mem_size_mib} MiB`,
          vm.ip_address ?? pc.dim("—"),
          formatElapsed(vm.uptime_seconds),
          pc.dim(formatTimestamp(vm.created_at, true)),
        ])
      }

      console.log(table.toString())
    }),
  )
