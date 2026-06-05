import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"

const name = process.argv[2]
if (!name) {
  console.error("usage: node create-agent.mjs <name>")
  process.exit(1)
}

const client = new Anthropic()

const TOOLS = ["bash", "read", "write"]

const SYSTEM = `You are a benchmarking agent. The Superserve Python SDK is installed in your sandbox.

When asked to benchmark code:
1. Design the variant matrix (algorithm × parameter × size)
2. Write the benchmark script at /workspace/benchmark.py
3. Write a parallel harness at /workspace/run_parallel.py that:
   - Uses asyncio + AsyncSandbox to create one sandbox per variant
   - Uploads benchmark.py to each, runs it, collects stdout
   - Kills all sub-sandboxes when done
   - Writes a results table to /workspace/results.md
4. Run: SUPERSERVE_API_KEY=$SUPERSERVE_API_KEY python3 /workspace/run_parallel.py
5. Read results.md and report the comparison with a clear winner

Keep variant count <= 20. Always kill sub-sandboxes — never leave them running.
Create sub-sandboxes with from_template="superserve/python-3.11" so python3 is
available to run benchmark.py. If a benchmark needs extra packages, install them at
the start of benchmark.py or use a template that already includes them. Other
prebuilt templates are available (e.g. superserve/python-ml for numpy/pandas,
superserve/code-interpreter for data/plotting, superserve/node-22 for Node).`

for await (const existing of client.beta.agents.list()) {
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
