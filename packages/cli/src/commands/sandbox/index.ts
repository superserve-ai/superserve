import { Command } from "commander"

import { download } from "./download"

export const sandbox = new Command("sandbox")
  .description("Work with sandboxes")
  .addCommand(download)
