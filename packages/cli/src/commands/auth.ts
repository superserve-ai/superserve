import { Sandbox } from "@superserve/sdk"
import type { Command } from "commander"

import { apiFetch } from "../api"
import { readSecret } from "../args"
import {
  clearCredentials,
  connection,
  CONSOLE_URL,
  maskKey,
  readCredentials,
  regionOf,
  writeCredentials,
} from "../config"
import { CliError, EXIT } from "../errors"
import {
  color,
  info,
  isJson,
  printFields,
  printJson,
  success,
  warn,
  withSpinner,
} from "../output"

export function register(program: Command): void {
  program
    .command("login")
    .description("Save an API key for this machine")
    .option(
      "--base-url <url>",
      "Control-plane URL to save with the key (for non-production endpoints)",
    )
    .addHelpText(
      "after",
      `
The key is read from a hidden prompt, or from stdin when piped:
  superserve login
  echo "$SUPERSERVE_API_KEY" | superserve login

Create a key at ${CONSOLE_URL}/api-keys
SUPERSERVE_API_KEY, when set, takes precedence over the saved key.`,
    )
    .action(async (opts: { baseUrl?: string }) => {
      if (process.stdin.isTTY) {
        info(`Create an API key at ${color.cyan(`${CONSOLE_URL}/api-keys`)}`)
      }
      const apiKey = (await readSecret("API key: ")).trim()
      const baseUrl = opts.baseUrl?.trim() || undefined
      // Non-production endpoints (e.g. a local backend) issue ss_dev_ keys.
      const prefixes = baseUrl ? ["ss_live_", "ss_dev_"] : ["ss_live_"]
      if (!prefixes.some((p) => apiKey.startsWith(p))) {
        throw new CliError(
          "That doesn't look like a Superserve API key (expected ss_live_…).",
          EXIT.USAGE,
        )
      }
      // Validate before saving so a typo never replaces a working key.
      await withSpinner("Checking key", () =>
        Sandbox.list({ apiKey, baseUrl, limit: 1 }),
      )
      const path = writeCredentials({ api_key: apiKey, base_url: baseUrl })
      if (isJson()) {
        printJson({ logged_in: true, key: maskKey(apiKey), path })
        return
      }
      success(`Logged in with ${maskKey(apiKey)}`)
      info(color.dim(`Saved to ${path}`))
      if (process.env.SUPERSERVE_API_KEY) {
        warn("SUPERSERVE_API_KEY is set and overrides the saved key.")
      }
    })

  program
    .command("logout")
    .description("Remove the saved API key")
    .action(() => {
      const removed = clearCredentials()
      if (isJson()) {
        printJson({ logged_out: removed })
      } else {
        info(removed ? "Logged out." : "No saved key.")
      }
      if (process.env.SUPERSERVE_API_KEY) {
        warn("SUPERSERVE_API_KEY is still set in your environment.")
      }
    })

  program
    .command("whoami")
    .alias("status")
    .description(
      "Show which API key and endpoints are in use, and check the key",
    )
    .action(async () => {
      const conn = connection()
      // A one-row list is the cheapest authenticated call; the total count
      // header doubles as a useful summary.
      const res = await withSpinner("Checking key", () =>
        apiFetch("GET", "/sandboxes", { query: { limit: "1" } }),
      )
      const total = res.headers.get("X-Total-Count") ?? undefined
      const result = {
        key: maskKey(conn.apiKey),
        source: conn.source,
        region: regionOf(conn.apiKey) ?? "default",
        api_url: conn.baseUrl,
        sandbox_host: conn.sandboxHost,
        sandboxes: total !== undefined ? Number(total) : undefined,
        valid: true,
      }
      if (isJson()) {
        printJson(result)
        return
      }
      printFields([
        ["Key", result.key],
        [
          "Source",
          conn.source === "env"
            ? "SUPERSERVE_API_KEY"
            : readCredentials()
              ? "saved credentials"
              : conn.source,
        ],
        ["Region", result.region],
        ["API", result.api_url],
        ["Sandbox host", result.sandbox_host],
        ["Sandboxes", total],
      ])
    })
}
