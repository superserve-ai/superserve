import { randomUUID } from "node:crypto"
import { unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"

import { track } from "../analytics"
import { createClient } from "../api/client"
import { PlatformAPIError } from "../api/errors"
import { loadProjectConfig } from "../config/project"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { formatElapsed, formatSize } from "../utils/format"
import { makeTarball } from "../utils/fs"
import { confirm } from "../utils/prompt"
import { createSpinner } from "../utils/spinner"

function writeTempTarball(data: Uint8Array): string {
  const path = join(tmpdir(), `superserve-${randomUUID()}.tar.gz`)
  writeFileSync(path, data)
  return path
}

export const deploy = new Command("deploy")
  .description("Deploy an agent to Superserve")
  .option("--dir <path>", "Project directory (default: current directory)", ".")
  .option("--json", "Output as JSON")
  .option("-y, --yes", "Skip confirmation")
  .action(
    withErrorHandler(
      async (options: { dir: string; json?: boolean; yes?: boolean }) => {
        const config = loadProjectConfig(options.dir)
        const client = createClient()
        const { name, command } = config

        // Check if agent already exists and confirm overwrite
        if (!options.json && !options.yes) {
          try {
            await client.getAgent(name)
            const ok = await confirm(
              `Agent '${name}' already exists. Redeploy?`,
            )
            if (!ok) {
              console.log("Cancelled")
              return
            }
          } catch (e) {
            if (!(e instanceof PlatformAPIError && e.statusCode === 404)) {
              throw e
            }
          }
        }

        const userIgnores = new Set(config.ignore ?? [])

        // JSON mode: simple output, no spinners
        if (options.json) {
          let tarballPath: string | undefined
          try {
            const tarballBytes = await makeTarball(options.dir, userIgnores)
            tarballPath = writeTempTarball(tarballBytes)
            const agent = await client.deployAgent(
              name,
              command,
              config,
              tarballPath,
            )
            await track("cli_deploy_success", {
              agent_name: name,
              tarball_bytes: tarballBytes.length,
            })
            console.log(JSON.stringify(agent, null, 2))
          } finally {
            if (tarballPath) {
              try {
                unlinkSync(tarballPath)
              } catch {}
            }
          }
          return
        }

        // Interactive mode with spinners
        console.log()
        const deployStart = performance.now()
        const status = createSpinner({ indent: 2 })

        // Package
        status.start("Packaging project...")
        const tarballBytes = await makeTarball(options.dir, userIgnores)
        status.done("\u2713", `(${formatSize(tarballBytes.length)})`)

        // Upload
        status.start("Uploading to Superserve...")
        const tarballPath = writeTempTarball(tarballBytes)

        let agent
        try {
          agent = await client.deployAgent(name, command, config, tarballPath)
          status.done()
        } finally {
          try {
            unlinkSync(tarballPath)
          } catch {}
        }

        // Wait for dependency installation (sandbox template build)
        if (agent.sandbox_status === "building") {
          status.start("Installing dependencies...")
          const pollInterval = 3000
          const maxWait = 300_000
          let elapsed = 0
          const buildStart = performance.now()

          while (elapsed < maxWait) {
            await Bun.sleep(pollInterval)
            elapsed += pollInterval

            agent = await client.getAgent(name)

            if (agent.sandbox_status === "ready") {
              status.done(
                "\u2713",
                `(${formatElapsed((performance.now() - buildStart) / 1000)})`,
              )
              break
            }
            if (agent.sandbox_status === "failed") {
              status.fail()
              await track("cli_deploy_build_failed", { agent_name: name })
              console.error()
              console.error("Agent created but dependency install failed.")
              console.error("Fix your requirements and run:")
              console.error(commandBox("superserve deploy"))
              process.exitCode = 1
              return
            }
          }

          if (agent.sandbox_status === "building") {
            status.fail("(timed out)")
            await track("cli_deploy_build_timeout", { agent_name: name })
            console.error(
              "\nDependency install is still running. Check status with:",
            )
            console.error(commandBox(`superserve agents get ${name}`))
            process.exitCode = 1
            return
          }
        }

        // Done
        const totalSeconds = (performance.now() - deployStart) / 1000
        const totalTime = formatElapsed(totalSeconds)
        await track("cli_deploy_success", {
          agent_name: name,
          tarball_bytes: tarballBytes.length,
          duration_s: Math.round(totalSeconds),
        })
        console.log()
        console.log(`  Deployed '${agent.name}' in ${totalTime}`)

        // Secrets
        const required = config.secrets ?? []
        if (required.length > 0) {
          const missing = required.filter(
            (s) => !agent.environment_keys.includes(s),
          )
          if (missing.length > 0) {
            console.log()
            console.log("  Set your secrets before running:")
            for (const key of missing) {
              console.log(
                commandBox(`superserve secrets set ${config.name} ${key}=...`),
              )
            }
          }
        } else if (agent.environment_keys.length === 0) {
          console.log()
          console.log("  Set your API keys as secrets:")
          console.log(
            commandBox(`superserve secrets set ${config.name} KEY=VALUE`),
          )
        }

        console.log()
        console.log(
          commandBox(`superserve run ${agent.name} "your prompt here"`),
        )
        console.log()
      },
    ),
  )
