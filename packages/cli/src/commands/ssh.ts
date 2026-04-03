import { Command } from "commander"
import { track } from "../analytics"
import { createClient } from "../api/client"
import { PlatformAPIError } from "../api/errors"
import { getApiKey } from "../config/auth"
import { PLATFORM_API_URL } from "../config/constants"
import { withErrorHandler } from "../errors"
import { log } from "../utils/logger"

export const ssh = new Command("ssh")
  .description("Open an interactive terminal session to a VM")
  .argument("<vm_id>", "VM identifier")
  .action(
    withErrorHandler(async (vmId: string) => {
      // Verify VM exists and is running
      const client = createClient()
      const vm = await client.getVm(vmId)
      if (vm.status !== "RUNNING") {
        log.error(`VM is ${vm.status}. SSH requires the VM to be RUNNING.`)
        process.exitCode = 1
        return
      }

      await track("cli_ssh")

      const apiKey = getApiKey()
      if (!apiKey) {
        throw new PlatformAPIError(
          401,
          "Not authenticated. Run `superserve login` first.",
        )
      }

      const baseUrl = PLATFORM_API_URL.replace(/\/+$/, "")
      const wsUrl = baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")

      const url = `${wsUrl}/v1/vms/${encodeURIComponent(vmId)}/logs/stream`

      const ws = new WebSocket(url, {
        // @ts-expect-error Bun WebSocket supports headers
        headers: { "X-API-Key": apiKey },
      })

      // Set terminal to raw mode for interactive session
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
      process.stdin.resume()

      ws.addEventListener("open", () => {
        log.success(`Connected to ${vm.name} (${vmId})`)
        console.log("Press Ctrl+] to disconnect.\n")
      })

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            line?: string
          }
          if (data.line) {
            process.stdout.write(data.line)
          }
        } catch {
          process.stdout.write(String(event.data))
        }
      })

      ws.addEventListener("close", () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        console.log("\nDisconnected.")
        process.exit(0)
      })

      ws.addEventListener("error", (event) => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        log.error(`WebSocket error: ${event}`)
        process.exitCode = 1
      })

      // Forward stdin to WebSocket
      process.stdin.on("data", (data: Buffer) => {
        // Ctrl+] to disconnect
        if (data[0] === 0x1d) {
          ws.close()
          return
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data.toString())
        }
      })
    }),
  )
