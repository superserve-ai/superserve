#!/usr/bin/env bun
import { Command } from "commander"
import { flushAnalytics, registerExitHook, track } from "./analytics"
import { checkpoint } from "./commands/checkpoint/index"
import { exec } from "./commands/exec"
import { files } from "./commands/files/index"
import { fork } from "./commands/fork/index"
import { login } from "./commands/login"
import { logout } from "./commands/logout"
import { rollback } from "./commands/rollback"
import { ssh } from "./commands/ssh"
import { vm } from "./commands/vm/index"
import { CLI_VERSION } from "./config/constants"
import { handleError } from "./errors"

const program = new Command()
  .name("superserve")
  .description("Superserve CLI - Create and manage cloud micro-VMs")
  .version(CLI_VERSION, "-v, --version")
  .option("--no-color", "Disable colored output")
  .option("--json", "Output as JSON (where supported)")

// Authentication
program.addCommand(login)
program.addCommand(logout)

// VM management
program.addCommand(vm)
program.addCommand(exec)
program.addCommand(ssh)
program.addCommand(files)

// Checkpoint / rollback / fork
program.addCommand(checkpoint)
program.addCommand(rollback)
program.addCommand(fork)

registerExitHook()

// Global error handler (safety net)
async function main() {
  try {
    // Track which command is being invoked (e.g. "vm list", "exec")
    const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"))
    const SUB_COMMAND_GROUPS = new Set(["vm", "files", "checkpoint", "fork"])
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
