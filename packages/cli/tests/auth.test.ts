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

describe("retry backoff", () => {
  test("an abort during a Retry-After wait stops the request at once", async () => {
    const { apiRequest } = await import("../src/api")
    const ac = new AbortController()
    const saved = globalThis.fetch
    globalThis.fetch = (async () =>
      json({}, 429, { "Retry-After": "30" })) as unknown as typeof fetch
    const savedKey = process.env.SUPERSERVE_API_KEY
    process.env.SUPERSERVE_API_KEY = TEST_KEY
    const started = Date.now()
    setTimeout(() => ac.abort(), 50)
    try {
      await expect(
        apiRequest("GET", "/sandboxes", { signal: ac.signal }),
      ).rejects.toBeDefined()
    } finally {
      globalThis.fetch = saved
      if (savedKey === undefined) delete process.env.SUPERSERVE_API_KEY
      else process.env.SUPERSERVE_API_KEY = savedKey
    }
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe("response bodies", () => {
  test("a truncated GET body is retried", async () => {
    let n = 0
    const r = await runCli(["sandbox", "list", "--json"], {
      fetch: () =>
        ++n === 1
          ? new Response('[{"id":', {
              headers: { "Content-Type": "application/json" },
            })
          : json([]),
    })
    expect(r.exitCode).toBe(0)
    expect(n).toBe(2)
  })
})

describe("dev keys", () => {
  test("ss_dev_ keys are accepted only with a custom --base-url", async () => {
    const env = { SUPERSERVE_API_KEY: undefined }
    const key = `ss_dev_${"C".repeat(32)}`
    const prod = await runCli(["login"], {
      env,
      stdin: key,
      fetch: () => json([]),
    })
    expect(prod.exitCode).toBe(2)
    const local = await runCli(
      ["login", "--base-url", "http://localhost:8080"],
      {
        env,
        stdin: key,
        fetch: (req) =>
          req.url.host === "localhost:8080" ? json([]) : undefined,
      },
    )
    expect(local.exitCode).toBe(0)
  })
})
