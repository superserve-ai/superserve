import { randomUUID } from "node:crypto"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, extname, join, resolve } from "node:path"
import { Command } from "commander"

import { track } from "../analytics"
import { createClient } from "../api/client"
import { PlatformAPIError } from "../api/errors"
import type { AgentResponse } from "../api/types"
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

const EXTENSION_COMMANDS: Record<string, string> = {
  ".py": "python",
  ".ts": "npx tsx",
  ".tsx": "npx tsx",
  ".js": "node",
  ".jsx": "node",
  ".mjs": "node",
  ".cjs": "node",
}

function detectCommand(entrypoint: string): string {
  const ext = extname(entrypoint)
  const runtime = EXTENSION_COMMANDS[ext] ?? "python"
  return `${runtime} ${entrypoint}`
}

export const deploy = new Command("deploy")
  .description("Deploy an agent to Superserve")
  .argument("[entrypoint]", "Script to run (e.g. agent.py, src/main.ts)")
  .option("-n, --name <name>", "Agent name (default: directory name)")
  .option("-p, --port <port>", "HTTP proxy mode — forward to this port", Number)
  .option("--dir <path>", "Project directory (default: current directory)", ".")
  .option("--json", "Output as JSON")
  .option("-y, --yes", "Skip confirmation")
  .action(
    withErrorHandler(
      async (
        entrypoint: string | undefined,
        options: {
          name?: string
          port?: number
          dir: string
          json?: boolean
          yes?: boolean
        },
      ) => {
        const client = createClient()
        let name: string
        let command: string
        let config: Record<string, unknown>
        let userIgnores: Set<string> | undefined

        if (entrypoint) {
          // Zero-config deploy
          const projectDir = resolve(options.dir)
          const entrypointPath = join(projectDir, entrypoint)

          if (!existsSync(entrypointPath)) {
            throw new Error(
              `Entrypoint file '${entrypoint}' not found in ${projectDir}.`,
            )
          }

          name = options.name ?? basename(projectDir)
          command = detectCommand(entrypoint)
          const mode = options.port ? "http" : "shim"
          config = { name, command, entrypoint, mode }
          if (options.port) {
            config.port = options.port
          }
          userIgnores = undefined
        } else {
          // Config mode: try to load superserve.yaml
          try {
            const loaded = loadProjectConfig(options.dir)
            name = loaded.name
            command = loaded.command
            config = loaded as Record<string, unknown>
            userIgnores = new Set(loaded.ignore ?? [])
          } catch {
            throw new Error(
              "Usage: superserve deploy <entrypoint> or create a superserve.yaml",
            )
          }
        }

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

        const ignores = userIgnores ?? new Set<string>()

        // JSON mode: simple output, no spinners
        if (options.json) {
          let tarballPath: string | undefined
          try {
            const tarballBytes = await makeTarball(options.dir, ignores)
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
        const tarballBytes = await makeTarball(options.dir, ignores)
        status.done("\u2713", `(${formatSize(tarballBytes.length)})`)

        // Upload
        status.start("Uploading to Superserve...")
        const tarballPath = writeTempTarball(tarballBytes)

        let agent: AgentResponse
        try {
          agent = await client.deployAgent(name, command, config, tarballPath)
          status.done()
        } finally {
          try {
            unlinkSync(tarballPath)
          } catch {}
        }

        // Wait for dependency installation (sandbox template build)
        if (agent.deps_status === "building") {
          status.start("Installing dependencies...")
          const pollInterval = 3000
          const maxWait = 300_000
          let elapsed = 0
          const buildStart = performance.now()

          while (elapsed < maxWait) {
            await Bun.sleep(pollInterval)
            elapsed += pollInterval

            agent = await client.getAgent(name)

            if (agent.deps_status === "ready") {
              status.done(
                "\u2713",
                `(${formatElapsed((performance.now() - buildStart) / 1000)})`,
              )
              break
            }
            if (agent.deps_status === "failed") {
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

          if (agent.deps_status === "building") {
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
        const required = (config.secrets as string[] | undefined) ?? []
        if (required.length > 0) {
          const missing = required.filter(
            (s) => !agent.environment_keys.includes(s),
          )
          if (missing.length > 0) {
            console.log()
            console.log("  Set your secrets before running:")
            for (const key of missing) {
              console.log(
                commandBox(`superserve secrets set ${name} ${key}=...`),
              )
            }
          }
        } else if (agent.environment_keys.length === 0) {
          console.log()
          console.log("  Set your API keys as secrets:")
          console.log(commandBox(`superserve secrets set ${name} KEY=VALUE`))
        }

        console.log()
        console.log(
          commandBox(`superserve run ${agent.name} "your prompt here"`),
        )
        console.log()
        console.log(`  Or try it in the Playground:`)
        console.log(`  https://playground.superserve.ai/agents/${agent.id}/`)
        console.log()
      },
    ),
  )
