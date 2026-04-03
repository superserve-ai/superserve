import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { log } from "../../utils/logger"
import { coloredStatus } from "../vm/format"
import { forkTree } from "./tree"

const forkCommand = new Command("fork")
  .description("Fork a VM into one or more clones")
  .argument("<vm_id>", "VM identifier")
  .option("--count <n>", "Number of clones to create", Number.parseInt, 1)
  .option("--from-checkpoint <id>", "Fork from a specific checkpoint")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (
        vmId: string,
        options: {
          count: number
          fromCheckpoint?: string
          json?: boolean
        },
      ) => {
        const client = createClient()
        const start = performance.now()
        const result = await client.fork(vmId, {
          count: options.count,
          from_checkpoint_id: options.fromCheckpoint,
        })
        const durationMs = Math.round(performance.now() - start)

        await track("cli_fork", {
          count: options.count,
          duration_ms: durationMs,
        })

        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        log.success(
          `Forked ${result.vms.length} VM(s) from checkpoint ${pc.dim(result.checkpoint_id)}`,
        )
        for (const vm of result.vms) {
          console.log(
            `  ${pc.bold(vm.name)} (${pc.dim(vm.id)}) — ${coloredStatus(vm.status)}`,
          )
        }
      },
    ),
  )

forkCommand.addCommand(forkTree)

export const fork = forkCommand
