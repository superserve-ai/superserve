import { Command } from "commander"

import { register as registerAuth } from "./commands/auth"
import { register as registerCompletion } from "./commands/completion"
import { register as registerExec } from "./commands/exec"
import { register as registerFiles } from "./commands/files"
import { register as registerPreview } from "./commands/preview"
import { register as registerSandbox } from "./commands/sandbox"
import { register as registerSecret } from "./commands/secret"
import { register as registerSnapshot } from "./commands/snapshot"
import { register as registerTemplate } from "./commands/template"
import { resetConnection, VERSION } from "./config"
import { handleError } from "./errors"
import { commanderError, setJsonMode } from "./output"
import { recordCommand } from "./telemetry"

/** A fresh program per call so tests can run the CLI in-process. */
export function buildProgram(onCommand: (path: string) => void): Command {
  const program: Command = new Command("superserve")
    .description("Run code in Superserve sandboxes from your terminal")
    .version(VERSION, "-v, --version", "Print the CLI version")
    .option("--json", "Print machine-readable JSON")
    .configureOutput({
      outputError: (str, write) => write(commanderError(str)),
    })
    .showSuggestionAfterError()
    .exitOverride()
    .hook("preAction", (_root, action) => {
      setJsonMode(Boolean(action.optsWithGlobals().json))
      const names: string[] = []
      for (let c: Command | null = action; c && c !== program; c = c.parent) {
        names.unshift(c.name())
      }
      onCommand(names.join(" "))
    })

  program.commandsGroup("Sandboxes:")
  registerSandbox(program)
  registerExec(program)
  registerFiles(program)
  registerPreview(program)
  registerSnapshot(program)
  program.commandsGroup("Build and configure:")
  registerTemplate(program)
  registerSecret(program)
  program.commandsGroup("Account:")
  registerAuth(program)
  registerCompletion(program)
  return program
}

/** A closed pipe (`... | head`) is the reader's choice, not a crash: exit quietly. */
export function installPipeGuard(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") throw err
      process.exit(typeof process.exitCode === "number" ? process.exitCode : 0)
    })
  }
}

/** Run the CLI and return its exit code. Never throws. */
export async function run(argv: string[]): Promise<number> {
  const started = performance.now()
  let commandPath = "help"
  let exitCode = 0
  resetConnection()
  // Commands report failures through process.exitCode; start each run clean.
  process.exitCode = 0
  // Parse errors are reported before preAction runs, so honour --json up front.
  const end = argv.indexOf("--")
  setJsonMode((end === -1 ? argv : argv.slice(0, end)).includes("--json"))
  try {
    const program = buildProgram((path) => {
      commandPath = path
    })
    await program.parseAsync(argv, { from: "user" })
    exitCode = typeof process.exitCode === "number" ? process.exitCode : 0
  } catch (err) {
    exitCode = handleError(err)
  }
  await recordCommand(commandPath, exitCode, performance.now() - started)
  return exitCode
}
