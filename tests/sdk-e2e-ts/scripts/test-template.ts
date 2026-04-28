/**
 * Standalone script to test creating a template with build steps via the SDK.
 *
 * Usage:
 *   1. Set the two consts below (API_KEY + BASE_URL).
 *   2. Run: `bun tests/sdk-e2e-ts/scripts/test-template.ts`
 *
 * The script creates a template with a multi-step build, streams build logs
 * to stdout, waits for the build to finish, prints the result, and cleans
 * up. If the build fails it prints the BuildError details and still cleans
 * up so you don't leave orphan templates around.
 */

import { BuildError, Template } from "@superserve/sdk"

// ---------------------------------------------------------------------------
// Edit these two values
// ---------------------------------------------------------------------------

const API_KEY = "ss_live_cgfHjivrhdbf09WTQyBPq-bhf0n6Wyy8"
const BASE_URL = "https://api-staging.superserve.ai"

// ---------------------------------------------------------------------------

async function main() {
  if (API_KEY === "ss_live_..." || !API_KEY) {
    console.error("Set API_KEY at the top of this script before running.")
    process.exit(1)
  }

  const alias = `test-tpl-${Date.now().toString(36)}`
  console.log(`Creating template: ${alias}`)
  console.log(`Target: ${BASE_URL}`)
  console.log()

  const template = await Template.create({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    alias,
    vcpu: 2,
    memoryMib: 2048,
    diskMib: 4096,
    from: "python:3.11",
    steps: [
      { run: "mkdir -p /srv/app" },
      { workdir: "/srv/app" },
      { env: { key: "GREETING", value: "hello-from-build" } },
      { run: 'sh -c "echo $GREETING > /srv/app/greet.txt"' },
      { run: "python --version > /srv/app/pyver.txt 2>&1" },
      { user: { name: "appuser", sudo: false } },
    ],
    startCmd: undefined, // set if you want a long-running process snapshotted
    readyCmd: undefined, // set to a probe command if you set startCmd
  })

  console.log(`Created. id=${template.id} build_id=${template.latestBuildId}`)
  console.log("--- build logs ---")

  try {
    await template.waitUntilReady({
      onLog: (ev) => {
        const tag = ev.stream === "system" ? "[sys] " : ""
        process.stdout.write(`${tag}${ev.text}`)
      },
    })
    const fresh = await template.getInfo()
    console.log("\n--- end logs ---")
    console.log(`Build succeeded. status=${fresh.status} built_at=${fresh.builtAt?.toISOString()}`)
    console.log(`Size: ${fresh.sizeBytes ?? "n/a"} bytes`)
  } catch (err) {
    console.log("\n--- end logs ---")
    if (err instanceof BuildError) {
      console.error("Build FAILED:")
      console.error(`  code:        ${err.code}`)
      console.error(`  template_id: ${err.templateId}`)
      console.error(`  build_id:    ${err.buildId}`)
      console.error(`  message:     ${err.message}`)
    } else {
      console.error("Unexpected error:", err)
    }
  } finally {
    // Cleanup intentionally commented out — leave the template around so
    // you can inspect it in the console / via the SDK.
    // try {
    //   await template.delete()
    //   console.log(`Deleted template ${template.id}`)
    // } catch (err) {
    //   console.error(`Cleanup failed for template ${template.id}:`, err)
    // }
    console.log(`Template left in place: ${template.id} (${template.alias})`)
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
