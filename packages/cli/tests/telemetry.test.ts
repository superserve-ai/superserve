import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { json, runCli } from "./harness"

const sentTelemetry = (r: { requests: { url: URL }[] }) =>
  r.requests.some((q) => q.url.hostname.endsWith("posthog.com"))

describe("telemetry opt-outs", () => {
  const run = (env: Record<string, string | undefined>) =>
    runCli(["whoami"], {
      env: { SUPERSERVE_TELEMETRY: undefined, ...env },
      fetch: () => json([]),
    })

  test("sends one event by default", async () => {
    expect(sentTelemetry(await run({}))).toBe(true)
  })

  test("honours opt-outs from earlier CLI versions", async () => {
    expect(sentTelemetry(await run({ SUPERSERVE_DO_NOT_TRACK: "1" }))).toBe(
      false,
    )
    const dir = mkdtempSync(join(tmpdir(), "ss-optout-"))
    writeFileSync(join(dir, ".analytics_disabled"), "")
    expect(sentTelemetry(await run({ SUPERSERVE_CONFIG_DIR: dir }))).toBe(false)
  })
})
