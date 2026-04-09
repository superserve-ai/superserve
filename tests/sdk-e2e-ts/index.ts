/**
 * End-to-end test for @superserve/sdk against a live Superserve environment.
 *
 * What it does:
 *   1. Creates a real sandbox
 *   2. Runs `uname -a && date` inside it
 *   3. Prints stdout, stderr, and the exit code
 *   4. Deletes the sandbox (in a finally block, so cleanup runs on failure)
 *
 * Credentials are required. This test is NOT wired into the default
 * `bun run test` pipeline — it runs only when explicitly invoked with
 * `bun run e2e` (or `bunx turbo run e2e` from the repo root).
 *
 * Defaults to staging; override the target with SUPERSERVE_BASE_URL.
 * Imports the SDK directly from `packages/sdk/src` via tsconfig paths, so
 * source changes are picked up with no build step.
 */

import { Superserve, SuperserveClient } from "@superserve/sdk"

const DEFAULT_BASE_URL = "https://api-staging.superserve.ai"
const baseUrl = process.env.SUPERSERVE_BASE_URL ?? DEFAULT_BASE_URL
const apiKey = process.env.SUPERSERVE_API_KEY

if (!apiKey) {
  console.error("Error: SUPERSERVE_API_KEY environment variable is required")
  console.error("")
  console.error("Usage:")
  console.error(`  SUPERSERVE_API_KEY=ss_... bun run e2e`)
  console.error("")
  console.error(`Defaults to ${DEFAULT_BASE_URL}.`)
  console.error(`Override with SUPERSERVE_BASE_URL=https://... to hit prod or local.`)
  process.exit(1)
}

const client = new SuperserveClient({ apiKey, baseUrl })

async function main() {
  console.log(`Target: ${baseUrl}`)
  console.log("")
  console.log("Creating sandbox...")

  const sandbox = await client.sandboxes.createSandbox({
    name: "sdk-e2e-ts",
  })
  console.log(`  id: ${sandbox.id}`)
  console.log(`  status: ${sandbox.status}`)
  console.log("")

  try {
    console.log("Running command: uname -a && date")
    const result = await client.exec.command({
      sandbox_id: sandbox.id!,
      body: { command: "uname -a && date" },
    })
    console.log("")
    console.log("--- stdout ---")
    console.log(result.stdout?.trimEnd() ?? "(empty)")
    if (result.stderr) {
      console.log("--- stderr ---")
      console.log(result.stderr.trimEnd())
    }
    console.log(`--- exit code: ${result.exit_code} ---`)
  } finally {
    console.log("")
    console.log(`Deleting sandbox ${sandbox.id}...`)
    await client.sandboxes.deleteSandbox({ sandbox_id: sandbox.id! })
    console.log("Done.")
  }
}

main().catch((err) => {
  console.error("")
  if (err instanceof Superserve.UnauthorizedError) {
    console.error("Auth failed — check your SUPERSERVE_API_KEY")
  } else if (err instanceof Superserve.BadRequestError) {
    console.error("Bad request:", err.body)
  } else {
    console.error("Error:", err)
  }
  process.exit(1)
})
