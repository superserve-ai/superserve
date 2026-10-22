import { describe, expect, test } from "bun:test"
import { mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { retryAfterMs } from "../src/api"
import { API, json, runCli, TEST_KEY } from "./harness"

describe("auth", () => {
  test("whoami reports the masked key, region and sandbox count", async () => {
    const r = await runCli(["whoami", "--json"], {
      fetch: (req) =>
        req.url.pathname === "/sandboxes"
          ? json([], 200, { "X-Total-Count": "7" })
          : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].url.toString()).toBe(`${API}/sandboxes?limit=1`)
    expect(r.requests[0].headers.get("X-API-Key")).toBe(TEST_KEY)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({
      key: "ss_live_use_AAAA…",
      region: "use",
      sandboxes: 7,
      source: "env",
    })
    expect(r.stdout).not.toContain(TEST_KEY)
  })

  test("a usw key routes to the usw cell", async () => {
    const key = `ss_live_usw_${"B".repeat(32)}`
    const r = await runCli(["whoami", "--json"], {
      env: { SUPERSERVE_API_KEY: key },
      fetch: () => json([]),
    })
    expect(r.requests[0].url.origin).toBe("https://api-usw.superserve.ai")
  })

  test("login saves a valid key (0600) and a rejected key is never saved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }

    const rejected = await runCli(["login"], {
      env,
      stdin: `${TEST_KEY}\n`,
      fetch: () =>
        json({ error: { code: "unauthorized", message: "invalid key" } }, 401),
    })
    expect(rejected.exitCode).toBe(3)
    expect((await runCli(["whoami"], { env })).exitCode).toBe(3)

    const ok = await runCli(["login"], {
      env,
      stdin: `${TEST_KEY}\n`,
      fetch: () => json([]),
    })
    expect(ok.exitCode).toBe(0)
    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600)
    const who = await runCli(["whoami", "--json"], {
      env,
      fetch: (req) =>
        req.headers.get("X-API-Key") === TEST_KEY ? json([]) : undefined,
    })
    expect(JSON.parse(who.stdout).source).toBe("credentials")
  })

  test("no key anywhere exits with the auth code", async () => {
    const r = await runCli(["whoami"], {
      env: { SUPERSERVE_API_KEY: undefined },
    })
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain("superserve login")
  })
})

describe("--json", () => {
  test("parse errors are JSON too, before any command runs", async () => {
    const r = await runCli(["sandbox", "get", "--json"])
    expect(r.exitCode).toBe(2)
    expect(JSON.parse(r.stderr).error.code).toBe("usage")
  })
})

describe("Retry-After", () => {
  test("accepts delta-seconds and HTTP-dates", () => {
    expect(retryAfterMs("2")).toBe(2000)
    const date = new Date(Date.now() + 5_000).toUTCString()
    expect(retryAfterMs(date)).toBeGreaterThan(3_000)
    expect(retryAfterMs("garbage")).toBeUndefined()
  })
})
