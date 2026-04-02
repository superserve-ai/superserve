import { Command } from "commander"
import { track } from "../analytics"
import { createClient } from "../api/client"
import { withErrorHandler } from "../errors"

export const exec = new Command("exec")
  .description("Run a shell command inside a VM")
  .argument("<vm_id>", "VM identifier")
  .argument("<command>", "Shell command to execute")
  .option(
    "--timeout <seconds>",
    "Execution timeout in seconds",
    Number.parseInt,
  )
  .option("--stream", "Stream output in real time via SSE")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(
      async (
        vmId: string,
        command: string,
        options: { timeout?: number; stream?: boolean; json?: boolean },
      ) => {
        const client = createClient()
        await track("cli_exec", { stream: !!options.stream })

        if (options.stream) {
          let exitCode = 0
          for await (const event of client.execStream(vmId, {
            command,
            timeout_s: options.timeout,
          })) {
            if (event.stdout) process.stdout.write(event.stdout)
            if (event.stderr) process.stderr.write(event.stderr)
            if (event.exit_code !== undefined) exitCode = event.exit_code
          }
          process.exitCode = exitCode
          return
        }

        const result = await client.exec(vmId, {
          command,
          timeout_s: options.timeout,
        })

        if (options.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        if (result.stdout) process.stdout.write(result.stdout)
        if (result.stderr) process.stderr.write(result.stderr)
        process.exitCode = result.exit_code
      },
    ),
  )
