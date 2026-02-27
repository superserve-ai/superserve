import { Command } from "commander"

import { track } from "../analytics"
import { createClient } from "../api/client"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { log } from "../utils/logger"
import { promptUser } from "../utils/prompt"
import { sanitizeTerminalOutput } from "../utils/sanitize"
import { createSpinner } from "../utils/spinner"
import { streamEvents, streamEventsJson } from "../utils/stream-events"

export const run = new Command("run")
  .description("Run a hosted agent interactively")
  .argument("<agent>", "Agent name or ID")
  .argument("[prompt]", "Initial prompt")
  .option("--single", "Exit after a single response (no interactive loop)")
  .option("--json", "Output raw JSON events")
  .action(
    withErrorHandler(
      async (
        agent: string,
        prompt: string | undefined,
        options: { single?: boolean; json?: boolean },
      ) => {
        const client = createClient()
        let spinner: Spinner | null = null

        // Handle Ctrl+C via AbortController so the listener is cleaned up
        const ac = new AbortController()
        const onSigint = () => {
          spinner?.stop()
          console.error("\nCancelled.")
          ac.abort()
          process.exitCode = 130
        }
        process.on("SIGINT", onSigint)
        ac.signal.addEventListener("abort", () => {
          process.off("SIGINT", onSigint)
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

        // Pre-flight: check required secrets
        let agentInfo: Awaited<ReturnType<typeof client.getAgent>> | null = null
        try {
          agentInfo = await client.getAgent(agent)
        } catch {
          // Let session creation handle auth/404 errors
        }
        if (agentInfo) {
          if (agentInfo.sandbox_status === "building") {
            log.error("Dependencies are still installing. Please wait and try again.")
            console.error("Check status with:")
            console.error(commandBox(`superserve agents get ${sanitizeTerminalOutput(agent)}`))
            process.exitCode = 1
            return
          }
          if (agentInfo.sandbox_status === "failed") {
            log.error("Dependency install failed. Redeploy to try again.")
            console.error(commandBox("superserve deploy"))
            process.exitCode = 1
            return
          }

          // Check required secrets
          if (agentInfo.required_secrets.length > 0) {
            const missing = agentInfo.required_secrets.filter(
              (s) => !agentInfo.environment_keys.includes(s),
            )
            if (missing.length > 0) {
              log.error(`Missing required secret(s): ${missing.join(", ")}`)
              console.error("Set them with:")
              console.error(
                commandBox(
                  `superserve secrets set ${agentInfo.name} ${missing.map((k) => `${k}=...`).join(" ")}`,
                ),
              )
              process.exitCode = 1
              return
            }
          }
        }

        try {
          if (useSpinner) {
            spinner = createSpinner({ showElapsed: true })
            spinner.start()
          }

          const runStart = performance.now()
          const sessionData = await client.createSession(agent)
          const sessionId = sessionData.id

          await track("cli_run_started", {
            agent_name: agent,
            mode: options.json
              ? "json"
              : options.single
                ? "single"
                : "interactive",
          })

          // Stream events
          let exitCode: number
          if (options.json) {
            exitCode = await streamEventsJson(
              client.streamSessionMessage(sessionId, prompt),
            )
          } else {
            exitCode = await streamEvents(
              client.streamSessionMessage(sessionId, prompt),
              spinner,
            )
          }
          if (exitCode) {
            await track("cli_run_failed", { agent_name: agent, messages: 1 })
            process.exitCode = exitCode
            return
          }

          if (!interactive) {
            await track("cli_run_completed", {
              agent_name: agent,
              messages: 1,
              duration_s: Math.round((performance.now() - runStart) / 1000),
            })
            return
          }

          // Interactive loop
          let messageCount = 1
          while (true) {
            const nextPrompt = await promptUser()
            if (
              !nextPrompt ||
              !nextPrompt.trim() ||
              nextPrompt.trim().toLowerCase() === "exit"
            ) {
              break
            }

            messageCount++
            spinner?.start()

            exitCode = await streamEvents(
              client.streamSessionMessage(sessionId, nextPrompt),
              spinner,
            )
            if (exitCode) {
              await track("cli_run_failed", {
                agent_name: agent,
                messages: messageCount,
              })
              process.exitCode = exitCode
              return
            }
          }

          await track("cli_run_completed", {
            agent_name: agent,
            messages: messageCount,
            duration_s: Math.round((performance.now() - runStart) / 1000),
          })
        } finally {
          spinner?.stop()
          process.off("SIGINT", onSigint)
        }
      },
    ),
  )
