import { Command } from "commander"
import pc from "picocolors"
import { track } from "../../analytics"
import { createClient } from "../../api/client"
import type { ForkTree } from "../../api/types"
import { withErrorHandler } from "../../errors"
import { coloredStatus } from "../vm/format"

function renderTree(node: ForkTree, prefix = "", isLast = true): string {
  const connector = prefix === "" ? "" : isLast ? "└── " : "├── "
  const statusStr = coloredStatus(node.status)
  let line = `${prefix}${connector}${pc.bold(node.name)} (${pc.dim(node.vm_id)}) ${statusStr}`

  if (node.forked_from_checkpoint_id) {
    line += ` ${pc.dim(`← ${node.forked_from_checkpoint_id}`)}`
  }

  const lines = [line]
  const childPrefix = prefix === "" ? "" : prefix + (isLast ? "    " : "│   ")

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    const last = i === node.children.length - 1
    lines.push(renderTree(child, childPrefix, last))
  }

  return lines.join("\n")
}

export const forkTree = new Command("tree")
  .description("Display the fork ancestry tree for a VM")
  .argument("<vm_id>", "VM identifier")
  .option("--json", "Output as JSON")
  .action(
    withErrorHandler(async (vmId: string, options: { json?: boolean }) => {
      const client = createClient()
      const tree = await client.getForkTree(vmId)
      await track("cli_fork_tree")

      if (options.json) {
        console.log(JSON.stringify(tree, null, 2))
        return
      }

      console.log(renderTree(tree))
    }),
  )
