import { describe, expect, test } from "bun:test"

import { json, runCli, SANDBOX_ID } from "./harness"

const PORTS = `/sandboxes/${SANDBOX_ID}/preview-ports`
const URL_3000 = `https://3000-${SANDBOX_ID}.sandbox.superserve.ai`

const tokenResponse = (extra: object = {}) =>
  json({
    token: "s3cr3t+/=",
    port: 3000,
    header: "X-Superserve-Preview-Token",
    query_param: "superserve_preview_token",
    access: "private",
    preview_access: "private",
    token_version: 2,
    ...extra,
  })

describe("preview", () => {
  test("publish --private posts the override and never activates", async () => {
    const r = await runCli(
      ["preview", "publish", SANDBOX_ID, "3000", "--private"],
      {
        fetch: (req) =>
          req.url.pathname === PORTS && req.method === "POST"
            ? json({ port: 3000, access: "private", token_version: 1 })
            : undefined,
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
    expect(r.requests[0].json()).toEqual({ port: 3000, access: "private" })
    expect(r.stdout.trim()).toBe(URL_3000)
  })

  test("url --signed mints a 60s token and keeps it off stderr", async () => {
    const r = await runCli(["preview", "url", SANDBOX_ID, "3000", "--signed"], {
      fetch: (req) =>
        req.url.pathname === `${PORTS}/3000/token`
          ? tokenResponse({ expires_at: "2030-01-01T00:00:00Z" })
          : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].json()).toEqual({ expires_in_seconds: 60 })
    const signed = new URL(r.stdout.trim())
    expect(signed.origin).toBe(URL_3000)
    expect(signed.searchParams.get("superserve_preview_token")).toBe(
      "s3cr3t+/=",
    )
    expect(r.stderr).not.toContain("s3cr3t")
  })

  test("token without --expires mints a non-expiring token", async () => {
    const r = await runCli(["preview", "token", SANDBOX_ID, "3000"], {
      fetch: (req) =>
        req.url.pathname === `${PORTS}/3000/token`
          ? tokenResponse()
          : undefined,
    })
    expect(r.requests[0].json()).toEqual({})
    expect(r.stdout.trim()).toBe("X-Superserve-Preview-Token: s3cr3t+/=")
  })

  test("reserved and privileged ports are rejected locally", async () => {
    for (const port of ["49983", "80", "70000", "abc"]) {
      const r = await runCli(["preview", "publish", SANDBOX_ID, port])
      expect(r.exitCode).toBe(2)
      expect(r.requests).toHaveLength(0)
    }
  })

  test("rotate refuses without --yes when non-interactive", async () => {
    const r = await runCli(["preview", "rotate", SANDBOX_ID, "3000"])
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
  })
})

describe("optional lists", () => {
  test("preview list and network-log survive omitted arrays", async () => {
    const list = await runCli(["preview", "list", SANDBOX_ID], {
      fetch: () => json({ preview_access: "public" }),
    })
    expect(list.exitCode).toBe(0)
    const log = await runCli(["sandbox", "network-log", SANDBOX_ID, "--all"], {
      fetch: () => json({ next_cursor: null, has_more: false }),
    })
    expect(log.exitCode).toBe(0)
  })
})
