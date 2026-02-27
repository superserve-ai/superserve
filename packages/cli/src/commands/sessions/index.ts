import { Command } from "commander"
import { endSession } from "./end"
import { getSession } from "./get"
import { listSessions } from "./list"
import { resumeSession } from "./resume"

export const sessions = new Command("sessions")
  .description("Manage agent sessions")
  .addCommand(listSessions)
  .addCommand(getSession)
  .addCommand(endSession)
  .addCommand(resumeSession)
