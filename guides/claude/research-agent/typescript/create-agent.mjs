import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"

const name = process.argv[2]
if (!name) {
  console.error("usage: node create-agent.mjs <name>")
  process.exit(1)
}

const client = new Anthropic()

const TOOLS = ["web_search", "web_fetch", "read", "write"]

const SYSTEM = `You are a research agent with a persistent sandbox. Your /workspace/research/ \
directory survives between sessions — always read your existing files first to orient yourself \
before starting new work.

Organize your work into:
- /workspace/research/notes.md — running observations and key findings
- /workspace/research/sources.md — URLs, titles, and one-line summaries
- /workspace/research/outline.md — evolving document structure
- /workspace/research/draft.md — the output being built

At the start of each session, check what exists: read each file if present, then continue \
from where you left off.

Save progress after every significant step. Search broadly first, then fetch and read the \
most relevant sources in depth. Cite everything.`

for await (const existing of client.beta.agents.list()) {
  if (existing.name === name && !existing.archived_at) {
    console.error(`agent named "${name}" already exists: ${existing.id}`)
    process.exit(1)
  }
}

const agent = await client.beta.agents.create({
  name,
  model: "claude-opus-4-8",
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
