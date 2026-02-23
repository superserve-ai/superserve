import { Command } from "commander"
import { resetIdentity, track } from "../analytics"
import { clearCredentials, getCredentials } from "../config/auth"
import { withErrorHandler } from "../errors"
import { log } from "../utils/logger"

export const logout = new Command("logout")
  .description("Log out from Superserve Cloud")
  .action(
    withErrorHandler(async () => {
      if (!getCredentials()) {
        console.log("Not logged in.")
        return
      }

      clearCredentials()
      resetIdentity()
      log.success("Logged out successfully.")
      await track("cli_logout")
    }),
  )
