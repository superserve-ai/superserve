import { Command } from "commander"
import { resetIdentity, track } from "../analytics"
import { clearCredentials, getApiKey } from "../config/auth"
import { withErrorHandler } from "../errors"
import { log } from "../utils/logger"

export const logout = new Command("logout")
  .description("Log out from Superserve")
  .action(
    withErrorHandler(async () => {
      if (!getApiKey()) {
        console.log("Not logged in.")
        return
      }

      clearCredentials()
      resetIdentity()
      log.success("Logged out successfully.")
      await track("cli_logout")
    }),
  )
