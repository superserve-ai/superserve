import { Command } from "commander"
import pc from "picocolors"
import { track } from "../analytics"
import { createClient } from "../api/client"
import { withErrorHandler } from "../errors"
import { log } from "../utils/logger"
import { coloredStatus } from "./vm/format"

export const rollback = new Command("rollback")
  .description("Rollback a VM to a previous checkpoint")
  .argument("<vm_id>", "VM identifier")
  .option("--checkpoint <id>", "Target checkpoint ID")
  .option("--name <name>", "Target checkpoint name")
  .option(
    "--minutes-ago <n>",
    "Roll back to closest checkpoint at least N minutes ago",
    Number.parseInt,
  )
  .option("--preserve-newer", "Keep checkpoints newer than the target")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (
        vmId: string,
        options: {
          checkpoint?: string
          name?: string
          minutesAgo?: number
          preserveNewer?: boolean
          json?: boolean
        },
      ) => {
        const targets = [
          options.checkpoint,
          options.name,
          options.minutesAgo,
        ].filter((v) => v !== undefined)
        if (targets.length !== 1) {
          log.error(
            "Exactly one of --checkpoint, --name, or --minutes-ago must be provided.",
          )
          process.exitCode = 1
          return
        }

        const client = createClient()
        const vm = await client.rollback(vmId, {
          checkpoint_id: options.checkpoint,
          name: options.name,
          minutes_ago: options.minutesAgo,
          preserve_newer: options.preserveNewer,
        })

        await track("cli_rollback")

        if (options.json) {
          console.log(JSON.stringify(vm, null, 2))
          return
        }

        log.success(
          `VM ${pc.bold(vm.name)} rolled back. Status: ${coloredStatus(vm.status)}`,
        )
      },
    ),
  )
