import { Command } from "commander"
import { createVmCommand } from "./create"
import { deleteVmCommand } from "./delete"
import { getVmCommand } from "./get"
import { listVmsCommand } from "./list"
import { sleepVmCommand } from "./sleep"
import { startVmCommand } from "./start"
import { stopVmCommand } from "./stop"
import { wakeVmCommand } from "./wake"

export const vm = new Command("vm")
  .description("Manage VMs")
  .addCommand(createVmCommand)
  .addCommand(listVmsCommand)
  .addCommand(getVmCommand)
  .addCommand(deleteVmCommand)
  .addCommand(stopVmCommand)
  .addCommand(startVmCommand)
  .addCommand(sleepVmCommand)
  .addCommand(wakeVmCommand)
