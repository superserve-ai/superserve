import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"

const name = process.argv[2]
if (!name) {
  console.error("usage: node create-agent.mjs <name>")
  process.exit(1)
}

const client = new Anthropic()

const TOOLS = ["bash", "read", "write", "edit", "glob", "grep"]

const SYSTEM = `You are a coding assistant with a persistent development environment at /workspace.
Your environment — installed packages, cloned repositories, build artifacts — survives between sessions.

At the start of every session:
1. Run: ls /workspace/ to see what's there
2. Read /workspace/.session-notes if it exists

After each session, update /workspace/.session-notes with:
- What repository is checked out and what branch
- What packages/tools are installed
- What you last worked on and what's next

This means: install dependencies once. Run tests instantly. Never re-clone.
Work carefully and test your changes before reporting completion.`

for (const existing of await client.beta.agents.list()) {
  if (existing.name === name && !existing.archived_at) {
    console.error(`agent named "${name}" already exists: ${existing.id}`)
    process.exit(1)
  }
}

const agent = await client.beta.agents.create({
  name,
  model: "claude-sonnet-4-6",
  system: SYSTEM,
  tools: [{
    type: "agent_toolset_20260401",
    default_config: { enabled: false, permission_policy: { type: "always_allow" } },
    configs: TOOLS.map((t) => ({
      name: t,
      enabled: true,
      permission_policy: { type: "always_allow" },
    })),
  }],
})

console.log(`created agent ${agent.id} (name: ${agent.name})`)
