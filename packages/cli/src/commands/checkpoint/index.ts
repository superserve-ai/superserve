import { Command } from "commander"
import { createCheckpointCommand } from "./create"
import { deleteCheckpointCommand } from "./delete"
import { listCheckpointsCommand } from "./list"

export const checkpoint = new Command("checkpoint")
  .description("Manage VM checkpoints")
  .addCommand(createCheckpointCommand)
  .addCommand(listCheckpointsCommand)
  .addCommand(deleteCheckpointCommand)
