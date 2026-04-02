import { Command } from "commander"
import { downloadFileCommand } from "./download"
import { uploadFileCommand } from "./upload"

export const files = new Command("files")
  .description("Upload and download files to/from VMs")
  .addCommand(uploadFileCommand)
  .addCommand(downloadFileCommand)
