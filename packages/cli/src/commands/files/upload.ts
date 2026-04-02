import { readFileSync } from "node:fs"
import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import { withErrorHandler } from "../../errors"
import { formatSize } from "../../utils/format"
import { log } from "../../utils/logger"
import { createSpinner } from "../../utils/spinner"

export const uploadFileCommand = new Command("upload")
  .description("Upload a local file into a VM")
  .argument("<vm_id>", "VM identifier")
  .argument("<local_path>", "Path to local file")
  .argument("<remote_path>", "Destination path inside the VM")
  .option("--mode <mode>", "Unix file mode in octal (e.g. 0755)")
  .action(
    withErrorHandler(
      async (
        vmId: string,
        localPath: string,
        remotePath: string,
        options: { mode?: string },
      ) => {
        const data = readFileSync(localPath)
        const spinner = createSpinner()
        spinner.start(`Uploading ${pc.bold(localPath)}...`)

        const client = createClient()
        await client.uploadFile(vmId, remotePath, data, options.mode)

        spinner.done()
        await track("cli_files_upload", { size: data.length })
        log.success(
          `Uploaded ${formatSize(data.length)} to ${pc.bold(remotePath)}`,
        )
      },
    ),
  )
