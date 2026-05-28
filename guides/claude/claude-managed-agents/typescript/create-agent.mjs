import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"

const name = process.argv[2]
if (!name) {
  console.error("usage: node create-agent.mjs <name>")
  process.exit(1)
}

const client = new Anthropic()

const TOOLS = ["bash", "read", "write", "edit", "glob", "grep", "web_fetch", "web_search"]

for (const existing of await client.beta.agents.list()) {
  if (existing.name === name && !existing.archived_at) {
    console.error(`agent named "${name}" already exists: ${existing.id}`)
    process.exit(1)
  }
}

const agent = await client.beta.agents.create({
  name,
  model: "claude-sonnet-4-6",
  system: "You have a working sandbox. Use your tools to do what is asked. Be terse.",
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
