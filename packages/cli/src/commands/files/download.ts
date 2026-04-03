import { writeFileSync } from "node:fs"
import { basename } from "node:path"
import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatSize } from "../../utils/format"
import { log } from "../../utils/logger"
import { createSpinner } from "../../utils/spinner"

export const downloadFileCommand = new Command("download")
  .description("Download a file from a VM")
  .argument("<vm_id>", "VM identifier")
  .argument("<remote_path>", "Path inside the VM")
  .argument("[local_path]", "Local destination (defaults to filename in cwd)")
  .action(
    withErrorHandler(
      async (vmId: string, remotePath: string, localPath?: string) => {
        const dest = localPath ?? basename(remotePath)
        const spinner = createSpinner()
        spinner.start(`Downloading ${pc.bold(remotePath)}...`)

        const client = createClient()
        const start = performance.now()
        const data = await client.downloadFile(vmId, remotePath)
        const durationMs = Math.round(performance.now() - start)

        writeFileSync(dest, data)
        spinner.done()
        await track("cli_files_download", {
          size: data.length,
          duration_ms: durationMs,
        })
        log.success(`Downloaded ${formatSize(data.length)} to ${pc.bold(dest)}`)
      },
    ),
  )
