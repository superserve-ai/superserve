import "dotenv/config"
import { Template } from "@superserve/sdk"

const TEMPLATE_NAME = "claude-benchmark-agent"

const existing = (await Template.list()).filter((t) => t.name === TEMPLATE_NAME)
if (existing.length > 0 && existing[0].status === "ready") {
  console.log(`template "${TEMPLATE_NAME}" already exists and is ready (id: ${existing[0].id})`)
  process.exit(0)
}

console.log(`creating template "${TEMPLATE_NAME}"...`)

const template = await Template.create({
  name: TEMPLATE_NAME,
  from: "python:3.12-slim",
  vcpu: 2,
  memoryMib: 2048,
  steps: [
    {
      run:
        "apt-get update && apt-get install -y --no-install-recommends " +
        "curl git jq procps && rm -rf /var/lib/apt/lists/*",
    },
    { run: "pip install --no-cache-dir anthropic superserve" },
    { run: "mkdir -p /workspace /mnt/session/outputs" },
    { workdir: "/workspace" },
  ],
})

console.log(`template created (id: ${template.id}), waiting for build...`)

await template.waitUntilReady({
  onLog: (ev) => {
    if (ev.stream !== "system") process.stdout.write(ev.text)
  },
})

console.log(`\ntemplate "${TEMPLATE_NAME}" is ready (id: ${template.id})`)
