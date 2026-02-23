import { Command } from "commander"

import { createClient } from "../api/client"
import type { RunEvent } from "../api/types"
import { withErrorHandler } from "../errors"
import { makeTarball } from "../utils/fs"
import { formatDuration } from "../utils/format"
import { log } from "../utils/logger"
import { promptUser } from "../utils/prompt"
import { sanitizeTerminalOutput } from "../utils/sanitize"
import { createSpinner, type Spinner } from "../utils/spinner"

async function streamClaudeEvents(
  events: AsyncIterableIterator<RunEvent>,
  spinner: Spinner | null,
): Promise<number> {
  for await (const event of events) {
    switch (event.type) {
      case "status": {
        // Show status messages (Preparing run..., Starting Claude..., etc.)
        const msg = (event.data as Record<string, string>).message
        if (msg && spinner) {
          spinner.text = msg
        }
        break
      }
      case "run.started":
      case "heartbeat":
        break
      case "message.delta": {
        spinner?.stop()
        process.stdout.write(sanitizeTerminalOutput(event.data.content ?? ""))
        break
      }
      case "tool.start": {
        spinner?.stop()
        const tool = event.data.tool ?? "unknown"
        const toolInput = String(event.data.input ?? {})
        const inputStr = sanitizeTerminalOutput(toolInput)
        const inputPreview =
          inputStr.length > 50 ? `${inputStr.slice(0, 50)}...` : inputStr
        process.stderr.write(`\n[${tool}] ${inputPreview}`)
        break
      }
      case "tool.end": {
        process.stderr.write(
          ` (${formatDuration(event.data.duration_ms ?? 0)})\n`,
        )
        spinner?.start()
        break
      }
      case "run.completed": {
        spinner?.stop()
        const durationMs = event.data.duration_ms ?? 0
        console.log()
        console.error(`\nCompleted in ${formatDuration(durationMs)}`)
        return 0
      }
      case "run.failed": {
        spinner?.stop()
        const errorMsg =
          event.data.error?.message ?? "Claude execution failed"
        log.error(errorMsg)
        return 1
      }
      case "run.cancelled": {
        spinner?.stop()
        console.error("\nSession was cancelled.")
        return 130
      }
    }
  }

  return 1
}

export const claude = new Command("claude")
  .description("Run Claude Code remotely on a Superserve sandbox")
  .argument("[prompt]", "Initial prompt for Claude")
  .option(
    "--worktree",
    "Upload current directory as a git worktree (excludes .git, node_modules, etc.)",
  )
  .option("--anthropic-api-key <key>", "Anthropic API key for Claude")
  .option("--single", "Exit after a single response (no interactive loop)")
  .option("--json", "Output raw JSON events")
  .option("--title <title>", "Session title")
  .action(
    withErrorHandler(
      async (
        prompt: string | undefined,
        options: {
          worktree?: boolean
          anthropicApiKey?: string
          single?: boolean
          json?: boolean
          title?: string
        },
      ) => {
        const client = createClient()
        let spinner: Spinner | null = null

        // Handle Ctrl+C — disconnect without killing session
        let sessionId: string | null = null
        process.on("SIGINT", () => {
          spinner?.stop()
          if (sessionId) {
            console.error(
              `\nDisconnected. Session ${sessionId} continues running.`,
            )
            console.error(`Reconnect with: superserve attach ${sessionId}`)
          } else {
            console.error("\nCancelled.")
          }
          process.exit(130)
        })

        // If no prompt, ask for one
        if (!prompt) {
          const p = await promptUser()
          if (!p || !p.trim()) return
          prompt = p
        }

        const interactive =
          !options.single && !options.json && process.stdin.isTTY
        const useSpinner = !options.json && process.stderr.isTTY

        try {
          if (useSpinner) {
            spinner = createSpinner({ showElapsed: true })
            spinner.text = "Packaging workspace..."
            spinner.start()
          }

          // Create tarball of current directory
          const cwd = process.cwd()
          const tarball = await makeTarball(cwd)

          // Write tarball to temp file for FormData upload
          const { tmpdir } = await import("node:os")
          const { join } = await import("node:path")
          const { writeFileSync, mkdtempSync, rmSync } = await import(
            "node:fs"
          )

          const tmpDir = mkdtempSync(join(tmpdir(), "superserve-claude-"))
          const tarballPath = join(tmpDir, "workspace.tar.gz")
          writeFileSync(tarballPath, tarball)

          if (spinner) spinner.text = "Creating Claude session..."

          // Create Claude session with tarball upload
          const sessionData = await client.createClaudeSession(tarballPath, {
            prompt,
            title:
              options.title ??
              `Claude: ${cwd.split("/").pop() ?? "workspace"}`,
            anthropicApiKey: options.anthropicApiKey,
          })
          sessionId = sessionData.id

          // Cleanup temp files
          rmSync(tmpDir, { recursive: true, force: true })

          if (!options.json) {
            console.error(`Session: ${sessionId}`)
          }

          if (spinner) spinner.text = "Claude is thinking..."

          // Stream first message
          let exitCode: number
          if (options.json) {
            exitCode = await streamClaudeEventsJson(
              client.streamClaudeMessage(sessionId, prompt),
            )
          } else {
            exitCode = await streamClaudeEvents(
              client.streamClaudeMessage(sessionId, prompt),
              spinner,
            )
          }
          if (exitCode) process.exit(exitCode)

          if (!interactive) return

          // Interactive loop — send follow-up messages
          while (true) {
            const nextPrompt = await promptUser()
            if (
              !nextPrompt ||
              !nextPrompt.trim() ||
              nextPrompt.trim().toLowerCase() === "exit"
            ) {
              break
            }

            spinner?.start()
            if (spinner) spinner.text = "Claude is thinking..."

            exitCode = await streamClaudeEvents(
              client.streamClaudeMessage(sessionId, nextPrompt),
              spinner,
            )
            if (exitCode) process.exit(exitCode)
          }
        } finally {
          spinner?.stop()
        }
      },
    ),
  )

async function streamClaudeEventsJson(
  eventIter: AsyncIterableIterator<RunEvent>,
): Promise<number> {
  for await (const event of eventIter) {
    console.log(JSON.stringify({ type: event.type, data: event.data }))
    if (event.type === "run.completed") return 0
    if (event.type === "run.failed") return 1
    if (event.type === "run.cancelled") return 130
  }
  return 1
}
