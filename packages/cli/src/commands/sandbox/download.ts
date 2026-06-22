import { writeFileSync } from "node:fs"

import { Command } from "commander"

import { track } from "../../analytics"
import { PLATFORM_API_URL } from "../../config/constants"
import { withErrorHandler } from "../../errors"
import { formatSize } from "../../utils/format"
import { log } from "../../utils/logger"
import { createSpinner } from "../../utils/spinner"

// Directory archives can be large; give the download more headroom than the
// SDK's 30s default.
const DOWNLOAD_TIMEOUT_MS = 300_000

/**
 * Derive the default output filename for a directory download.
 *
 * `/app/output` → `output.zip`; the sandbox root (`/`) has no basename, so it
 * falls back to `sandbox-<id>.zip`. The argument is a POSIX path, so `?`/`#`
 * are ordinary filename characters and are preserved.
 */
export function defaultZipName(remotePath: string, sandboxId: string): string {
  const parts = remotePath.split("/").filter(Boolean)
  const base = parts[parts.length - 1]
  return base ? `${base}.zip` : `sandbox-${sandboxId}.zip`
}

/**
 * Load the SDK on demand. Kept out of the module's static imports so the rest
 * of the CLI doesn't pull it in, and so a missing build (source checkout where
 * `@superserve/sdk` hasn't been built yet) surfaces an actionable message
 * instead of the generic error handler's fallback.
 */
async function loadSdk(): Promise<typeof import("@superserve/sdk")> {
  try {
    return await import("@superserve/sdk")
  } catch {
    throw new Error(
      "Could not load @superserve/sdk. From a source checkout, build it first: bun run build --filter=@superserve/sdk",
    )
  }
}

export async function runDownload(
  sandboxId: string,
  path: string,
  options: { output?: string; apiKey?: string },
): Promise<void> {
  const apiKey = options.apiKey ?? process.env.SUPERSERVE_API_KEY
  if (!apiKey) {
    throw new Error(
      "Directory download needs a Superserve API key. Pass --api-key or set SUPERSERVE_API_KEY.",
    )
  }

  const outputPath = options.output ?? defaultZipName(path, sandboxId)

  const spinner = createSpinner()
  spinner.start(`Downloading ${path} from ${sandboxId}`)
  try {
    const { Sandbox } = await loadSdk()
    const sandbox = await Sandbox.connect(sandboxId, {
      apiKey,
      baseUrl: PLATFORM_API_URL,
    })
    const zip = await sandbox.files.downloadDir(path, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    })
    writeFileSync(outputPath, zip)
    spinner.done("✓", `(${formatSize(zip.length)})`)
    log.success(`Saved ${outputPath}`)

    await track("cli_sandbox_download", { size_bytes: zip.length })
  } catch (e) {
    spinner.fail()
    throw e
  }
}

export const download = new Command("download")
  .description("Download a sandbox directory as a ZIP archive")
  .argument("<sandbox-id>", "Sandbox ID (UUID)")
  .argument("[path]", "Absolute directory path to download", "/")
  .option("-o, --output <file>", "Output .zip path (default: <dir>.zip)")
  .option(
    "--api-key <key>",
    "Superserve API key (defaults to SUPERSERVE_API_KEY)",
  )
  .action(
    withErrorHandler(
      (
        sandboxId: string,
        path: string,
        options: { output?: string; apiKey?: string },
      ) => runDownload(sandboxId, path, options),
    ),
  )
