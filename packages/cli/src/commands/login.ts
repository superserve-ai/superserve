import { Command } from "commander"
import { track } from "../analytics"
import { createClient } from "../api/client"
import { clearCredentials, getApiKey, saveApiKey } from "../config/auth"
import { withErrorHandler } from "../errors"
import { commandBox } from "../utils/command-box"
import { log } from "../utils/logger"
import { promptUser } from "../utils/prompt"

export const login = new Command("login")
  .description("Authenticate with Superserve")
  .option("--api-key <key>", "API key for authentication")
  .action(
    withErrorHandler(async (options: { apiKey?: string }) => {
      const existing = getApiKey()
      if (existing && !options.apiKey) {
        const client = createClient()
        if (await client.validateApiKey()) {
          console.log("Already logged in. To sign out, run:")
          console.log(commandBox("superserve logout"))
          return
        }
      }

      let apiKey = options.apiKey
      if (!apiKey) {
        apiKey = await promptUser(
          "Enter your API key (from https://console.superserve.ai): ",
        )
        if (!apiKey?.trim()) {
          log.error("No API key provided.")
          process.exitCode = 1
          return
        }
        apiKey = apiKey.trim()
      }

      saveApiKey(apiKey)

      const client = createClient()
      if (!(await client.validateApiKey())) {
        clearCredentials()
        log.error("Invalid API key.")
        process.exitCode = 1
        return
      }

      log.success("Authenticated successfully!")
      await track("cli_login", { method: "api_key" })
    }),
  )
