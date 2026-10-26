import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

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

  test("login with no key signs in from the browser and saves the minted key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    let polls = 0
    const r = await runCli(["login", "--json"], {
      env,
      fetch: (req) => {
        if (req.url.pathname === "/api/cli/device")
          return json({
            device_code: "secret-device-code",
            user_code: "BCDF-GHJK",
            verification_uri_complete:
              "https://console.superserve.ai/device?code=BCDF-GHJK",
            expires_in: 600,
            interval: 0,
          })
        if (req.url.pathname === "/api/cli/device/token") {
          expect(req.json()).toEqual({ device_code: "secret-device-code" })
          return ++polls < 2
            ? json({ error: "authorization_pending" }, 400)
            : json({ api_key: TEST_KEY, email: "dev@example.com" })
        }
        return req.url.pathname === "/sandboxes" ? json([]) : undefined
      },
    })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("BCDF-GHJK")
    expect(JSON.parse(r.stdout).logged_in).toBe(true)
    expect(polls).toBe(2)
    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600)
    expect(existsSync(join(dir, "pending-login.json"))).toBe(false)
  })

  test("login --no-wait prints the URL, and the next login resumes the same code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    const start = await runCli(["login", "--no-wait", "--json"], {
      env,
      fetch: (req) =>
        req.url.pathname === "/api/cli/device"
          ? json({
              device_code: "secret-device-code",
              user_code: "BCDF-GHJK",
              verification_uri_complete:
                "https://console.superserve.ai/device?code=BCDF-GHJK",
              expires_in: 600,
              interval: 0,
            })
          : undefined,
    })
    expect(start.exitCode).toBe(0)
    expect(JSON.parse(start.stdout)).toMatchObject({
      logged_in: false,
      user_code: "BCDF-GHJK",
      url: "https://console.superserve.ai/device?code=BCDF-GHJK",
    })

    const finish = await runCli(["login"], {
      env,
      fetch: (req) =>
        req.url.pathname === "/api/cli/device/token"
          ? json({ api_key: TEST_KEY })
          : req.url.pathname === "/sandboxes"
            ? json([])
            : undefined,
    })
    expect(finish.exitCode).toBe(0)
    expect(finish.requests.map((q) => q.url.pathname)).not.toContain(
      "/api/cli/device",
    )
  })

  test("an agent re-running login --no-wait collects an approved key after the original expiry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    writeFileSync(
      join(dir, "pending-login.json"),
      JSON.stringify({
        console_url: "https://console.superserve.ai",
        device_code: "secret-device-code",
        user_code: "BCDF-GHJK",
        url: "https://console.superserve.ai/device?code=BCDF-GHJK",
        // Past our own clock, but approval kept it redeemable on the server.
        expires_at: Date.now() - 60_000,
        interval: 0,
      }),
    )
    const r = await runCli(["login", "--no-wait", "--json"], {
      env,
      fetch: (req) =>
        req.url.pathname === "/api/cli/device/token"
          ? json({ api_key: TEST_KEY, new_account: true })
          : // The grant is spent, so an API outage must not lose the key.
            req.url.pathname === "/sandboxes"
            ? json({ error: "unavailable" }, 503)
            : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).logged_in).toBe(true)
    const saved = JSON.parse(
      readFileSync(join(dir, "credentials.json"), "utf8"),
    )
    expect(saved.api_key).toBe(TEST_KEY)
    expect(saved.setup_until).toBeGreaterThan(Date.now())
  })

  test("a resumed login saves the key for the --base-url it started with", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    writeFileSync(
      join(dir, "pending-login.json"),
      JSON.stringify({
        console_url: "https://console.superserve.ai",
        base_url: "https://api.example.com",
        device_code: "secret-device-code",
        user_code: "BCDF-GHJK",
        url: "https://console.superserve.ai/device?code=BCDF-GHJK",
        expires_at: Date.now() + 60_000,
        interval: 0,
      }),
    )
    const r = await runCli(["login"], {
      env,
      fetch: (req) =>
        req.url.pathname === "/api/cli/device/token"
          ? json({ api_key: TEST_KEY })
          : req.url.host === "api.example.com" &&
              req.url.pathname === "/sandboxes"
            ? json([])
            : undefined,
    })
    expect(r.exitCode).toBe(0)
    const saved = JSON.parse(
      readFileSync(join(dir, "credentials.json"), "utf8"),
    )
    expect(saved.base_url).toBe("https://api.example.com")
  })

  test("a resumed code the server has expired starts a fresh login", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    writeFileSync(
      join(dir, "pending-login.json"),
      JSON.stringify({
        console_url: "https://console.superserve.ai",
        device_code: "old-code",
        user_code: "BCDF-GHJK",
        url: "https://console.superserve.ai/device?code=BCDF-GHJK",
        expires_at: Date.now() - 60_000,
        interval: 0,
      }),
    )
    const r = await runCli(["login", "--no-wait", "--json"], {
      env,
      fetch: (req) => {
        if (req.url.pathname === "/api/cli/device/token")
          return json({ error: "expired_token" }, 400)
        if (req.url.pathname === "/api/cli/device")
          return json({
            device_code: "new-code",
            user_code: "LMNP-QRST",
            verification_uri_complete:
              "https://console.superserve.ai/device?code=LMNP-QRST",
            expires_in: 600,
            interval: 0,
          })
      },
    })
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({
      logged_in: false,
      user_code: "LMNP-QRST",
    })
  })

  test("a denied browser login fails with the auth code and saves nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    const env = { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir }
    const r = await runCli(["login"], {
      env,
      fetch: (req) =>
        req.url.pathname === "/api/cli/device"
          ? json({
              device_code: "d",
              user_code: "BCDF-GHJK",
              verification_uri_complete: "https://console.superserve.ai/device",
              expires_in: 600,
              interval: 0,
            })
          : json({ error: "access_denied", error_description: "Denied." }, 400),
    })
    expect(r.exitCode).toBe(3)
    expect(existsSync(join(dir, "credentials.json"))).toBe(false)
    expect(existsSync(join(dir, "pending-login.json"))).toBe(false)
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

describe("piped input", () => {
  test("login --with-key waits out a pause mid-key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "superserve-login-"))
    writeFileSync(join(dir, "pending-login.json"), "{}")
    const stdin = new Readable({ read() {} })
    stdin.push(TEST_KEY.slice(0, 3))
    setTimeout(() => {
      stdin.push(TEST_KEY.slice(3))
      stdin.push(null)
    }, 1_200)
    const r = await runCli(["login", "--with-key", "--json"], {
      env: { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir },
      stdin,
      fetch: (req) =>
        req.url.pathname === "/sandboxes" ? json([]) : undefined,
    })
    expect(r.exitCode).toBe(0)
    const saved = JSON.parse(
      readFileSync(join(dir, "credentials.json"), "utf8"),
    )
    expect(saved.api_key).toBe(TEST_KEY)
    expect(existsSync(join(dir, "pending-login.json"))).toBe(false)
  })

  test("doesn't wait on a stdin that stays open (agent harnesses)", async () => {
    const { readPipedInput } = await import("../src/args")
    const saved = Object.getOwnPropertyDescriptor(process, "stdin")
    const open = new Readable({ read() {} }) as Readable & { isTTY?: boolean }
    Object.defineProperty(process, "stdin", { value: open, configurable: true })
    try {
      const started = Date.now()
      expect(await readPipedInput(50)).toBe("")
      expect(Date.now() - started).toBeLessThan(1_000)
    } finally {
      if (saved) Object.defineProperty(process, "stdin", saved)
    }
  })
})
