#!/usr/bin/env bun
import { Command } from "commander"
import { flushAnalytics, registerExitHook, track } from "./analytics"
import { agents } from "./commands/agents/index"
import { deploy } from "./commands/deploy"
import { init } from "./commands/init"
import { login } from "./commands/login"
import { logout } from "./commands/logout"
import { run } from "./commands/run"
import { secrets } from "./commands/secrets/index"
import { sessions } from "./commands/sessions/index"
import { CLI_VERSION } from "./config/constants"
import { handleError } from "./errors"

const program = new Command()
  .name("superserve")
  .description(
    "Superserve CLI - Production infrastructure for agentic workloads",
  )
  .version(CLI_VERSION, "-v, --version")
  .option("--no-color", "Disable colored output")
  .option("--json", "Output as JSON (where supported)")

// Authentication
program.addCommand(login)
program.addCommand(logout)

// Project
program.addCommand(init)
program.addCommand(deploy)

// Run
program.addCommand(run)

// Resource management
program.addCommand(agents)
program.addCommand(secrets)
program.addCommand(sessions)

registerExitHook()

// Global error handler (safety net)
async function main() {
  try {
    // Track which command is being invoked (e.g. "agents list", "deploy")
    const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"))
    const SUB_COMMAND_GROUPS = new Set(["agents", "secrets", "sessions"])
    const depth = SUB_COMMAND_GROUPS.has(positional[0]) ? 2 : 1
    const command = positional.slice(0, depth).join(" ") || "help"
    await track("cli_command_invoked", { command })

    await program.parseAsync(process.argv)
  } catch (e) {
    process.exitCode = handleError(e)
  } finally {
    await flushAnalytics()
  }
}

main()
