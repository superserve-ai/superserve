import { describe, expect, test } from "bun:test"

import { API, apiError, json, runCli, SANDBOX_ID, TEST_KEY } from "./harness"

const SB = `/sandboxes/${SANDBOX_ID}`
const sandbox = (over: Record<string, unknown> = {}) => ({
  id: SANDBOX_ID,
  name: "dev",
  status: "active",
  vcpu_count: 2,
  memory_mib: 2048,
  metadata: {},
  ...over,
})

describe("sandbox", () => {
  test("create maps flags to the request and never prints the access token", async () => {
    const r = await runCli(
      [
        "sandbox",
        "create",
        "--json",
        "--name",
        "dev",
        "-t",
        "superserve/python-3.11",
        "--timeout",
        "30m",
        "--auto-delete",
        "0",
        "-m",
        "env=ci",
        "-e",
        "A=1=2",
        "-s",
        "OPENAI_API_KEY=openai-prod",
        "--allow-out",
        "api.example.com",
        "--deny-out",
        "0.0.0.0/0",
        "--preview-access",
        "private",
      ],
      {
        fetch: () =>
          json(sandbox({ access_token: "tok-secret", routing_hint: "h" }), 201),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
    expect(r.requests[0].method).toBe("POST")
    expect(r.requests[0].url.toString()).toBe(`${API}/sandboxes`)
    expect(r.requests[0].json()).toEqual({
      name: "dev",
      from_template: "superserve/python-3.11",
      timeout_seconds: 1800,
      auto_delete_seconds: 0,
      metadata: { env: "ci" },
      env_vars: { A: "1=2" },
      secrets: { OPENAI_API_KEY: "openai-prod" },
      network: { allow_out: ["api.example.com"], deny_out: ["0.0.0.0/0"] },
      preview_access: "private",
    })
    expect(r.stdout).not.toContain("tok-secret")
    expect(JSON.parse(r.stdout).routing_hint).toBe("h")

    const human = await runCli(["sandbox", "create"], {
      fetch: (req) =>
        json(
          sandbox({ name: req.json().name, access_token: "tok-secret" }),
          201,
        ),
    })
    expect(human.requests[0].json().name).toMatch(/^sandbox-[a-z0-9]{6}$/)
    expect(human.stdout + human.stderr).not.toContain("tok-secret")
  })

  test("create rejects bad input before sending", async () => {
    for (const args of [
      ["--template", "t", "--snapshot", SANDBOX_ID],
      ["--snapshot", "not-an-id"],
      ["--timeout", "8d"],
      ["--auto-delete", "31d"],
    ]) {
      const r = await runCli(["sandbox", "create", ...args])
      expect(r.exitCode).toBe(2)
      expect(r.requests).toHaveLength(0)
    }
  })

  test("list sends filters and reports the total when paginated", async () => {
    const r = await runCli(
      [
        "sb",
        "ls",
        "--status",
        "active,paused",
        "--status",
        "failed",
        "-m",
        "env=prod",
        "-q",
        "agent",
        "--limit",
        "1",
        "--sort",
        "name",
        "--order",
        "asc",
      ],
      { fetch: () => json([sandbox()], 200, { "X-Total-Count": "9" }) },
    )
    expect(r.exitCode).toBe(0)
    const q = r.requests[0].url.searchParams
    expect(q.get("status")).toBe("active,paused,failed")
    expect(q.get("metadata.env")).toBe("prod")
    expect(q.get("q")).toBe("agent")
    expect(q.get("limit")).toBe("1")
    expect(q.get("sort")).toBe("name")
    expect(q.get("order")).toBe("asc")
    expect(r.stdout).toContain("dev")
    expect(r.stderr).toContain("1-1 of 9")

    const bad = await runCli(["sb", "ls", "--status", "running"])
    expect(bad.exitCode).toBe(2)
    expect(bad.requests).toHaveLength(0)
  })

  test("get resolves a name with one list call and hides the token", async () => {
    const r = await runCli(["sandbox", "get", "dev", "--json"], {
      fetch: (req) =>
        req.url.pathname === "/sandboxes"
          ? json([sandbox()])
          : json(sandbox({ access_token: "tok-secret" })),
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests.map((q) => q.url.pathname)).toEqual(["/sandboxes", SB])
    expect(r.stdout).not.toContain("tok-secret")
  })

  test("update sends null to clear and replaces network rules", async () => {
    const r = await runCli(
      [
        "sandbox",
        "update",
        SANDBOX_ID,
        "--timeout",
        "none",
        "--auto-delete",
        "2h",
        "--allow-out",
        "api.example.com",
      ],
      { fetch: () => new Response(null, { status: 204 }) },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].method).toBe("PATCH")
    expect(r.requests[0].json()).toEqual({
      timeout_seconds: null,
      auto_delete_seconds: 7200,
      network: { allow_out: ["api.example.com"], deny_out: [] },
    })

    const empty = await runCli(["sandbox", "update", SANDBOX_ID])
    expect(empty.exitCode).toBe(2)
    expect(empty.requests).toHaveLength(0)
  })

  test("pause --no-wait asks for an async 202 and does not poll", async () => {
    const r = await runCli(
      ["sandbox", "pause", SANDBOX_ID, "--no-wait", "--json"],
      {
        fetch: () => json({ status: "pausing" }, 202),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
    expect(r.requests[0].headers.get("Prefer")).toBe("respond-async")
    expect(JSON.parse(r.stdout)).toEqual({ id: SANDBOX_ID, status: "pausing" })
  })

  test("pause follows a 202 until paused", async () => {
    let polls = 0
    const r = await runCli(["sandbox", "pause", SANDBOX_ID], {
      fetch: (req) => {
        if (req.method === "POST") return json({ status: "pausing" }, 202)
        polls++
        return json(sandbox({ status: polls < 2 ? "pausing" : "paused" }))
      },
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].headers.get("Prefer")).toBeNull()
    expect(polls).toBe(2)
  })

  test("pausing an already-paused sandbox succeeds", async () => {
    const r = await runCli(["sandbox", "pause", SANDBOX_ID], {
      fetch: (req) =>
        req.method === "POST"
          ? apiError(409, "conflict", "Sandbox is not in a valid state")
          : json(sandbox({ status: "paused" })),
    })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("already paused")
  })

  test("resume waits out a pause that is still finishing", async () => {
    let posts = 0
    const r = await runCli(["sandbox", "resume", SANDBOX_ID, "--json"], {
      fetch: () =>
        ++posts === 1
          ? apiError(409, "sandbox_pausing", "still pausing")
          : json({
              id: SANDBOX_ID,
              status: "active",
              access_token: "tok-secret",
            }),
    })
    expect(r.exitCode).toBe(0)
    expect(posts).toBe(2)
    expect(r.stdout).not.toContain("tok-secret")
  })

  test("delete refuses without --yes and treats 404 as already gone", async () => {
    const refused = await runCli(["sandbox", "rm", SANDBOX_ID])
    expect(refused.exitCode).toBe(2)
    expect(refused.requests).toHaveLength(0)

    const r = await runCli(["sandbox", "rm", SANDBOX_ID, "--yes"], {
      fetch: () => apiError(404, "not_found", "Sandbox not found"),
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].method).toBe("DELETE")
    expect(r.requests[0].url.pathname).toBe(SB)
  })

  test("network-log --all follows the cursor without activating", async () => {
    const r = await runCli(
      [
        "sandbox",
        "network-log",
        SANDBOX_ID,
        "--all",
        "--verdict",
        "blocked",
        "--json",
      ],
      {
        fetch: (req) =>
          req.url.searchParams.get("before") === "c1"
            ? json({
                data: [
                  { kind: "connection", id: 1, ts: "2026-01-01T00:00:00Z" },
                ],
                next_cursor: null,
                has_more: false,
              })
            : json({
                data: [
                  { kind: "connection", id: 2, ts: "2026-01-01T00:00:01Z" },
                ],
                next_cursor: "c1",
                has_more: true,
              }),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests.every((q) => q.url.pathname === `${SB}/network`)).toBe(
      true,
    )
    expect(r.requests).toHaveLength(2)
    expect(r.requests[1].url.searchParams.get("verdict")).toBe("blocked")
    expect(JSON.parse(r.stdout).data.map((e: { id: number }) => e.id)).toEqual([
      2, 1,
    ])
  })
})

describe("sandbox references", () => {
  const regional = "sb-usw-11111111-2222-4333-8444-555555555555"

  test("a region-prefixed ID is used directly, never looked up as a name", async () => {
    const r = await runCli(["sandbox", "get", regional, "--json"], {
      fetch: (req) =>
        req.url.pathname === `/sandboxes/${regional}`
          ? json({ id: regional, name: "box", status: "active" })
          : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests).toHaveLength(1)
  })

  test("bulk delete names every failure and exits non-zero", async () => {
    const ok = "11111111-1111-4111-8111-111111111111"
    const bad = "22222222-2222-4222-8222-222222222222"
    const r = await runCli(["sandbox", "rm", ok, bad, "--yes"], {
      fetch: (req) =>
        req.url.pathname.endsWith(ok)
          ? new Response(null, { status: 204 })
          : apiError(400, "bad_request", "cannot delete"),
    })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain(`${bad}: cannot delete`)
    expect(r.stderr).toContain(`Deleted ${ok}`)
  })
})

describe("pause wait", () => {
  test("an early 'active' after an accepted pause is not a failure", async () => {
    const states = ["active", "pausing", "paused"]
    const r = await runCli(["sandbox", "pause", SANDBOX_ID], {
      fetch: (req) =>
        req.method === "POST"
          ? json({ status: "pausing" }, 202)
          : json({ id: SANDBOX_ID, name: "box", status: states.shift() }),
    })
    expect(r.exitCode).toBe(0)
  })

  test("a sandbox auto-deleted on pause is reported as deleted", async () => {
    const r = await runCli(["sandbox", "pause", SANDBOX_ID, "--json"], {
      fetch: (req) =>
        req.method === "POST"
          ? json({ status: "pausing" }, 202)
          : apiError(404, "not_found", "gone"),
    })
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).status).toBe("deleted")
  })
})

describe("update metadata", () => {
  test("--clear-metadata sends an empty map", async () => {
    const r = await runCli(
      ["sandbox", "update", SANDBOX_ID, "--clear-metadata"],
      {
        fetch: () => new Response(null, { status: 204 }),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].json()).toEqual({ metadata: {} })
  })

  test("a 409 then 404 during pause recovery reports deleted", async () => {
    const r = await runCli(["sandbox", "pause", SANDBOX_ID, "--json"], {
      fetch: (req) =>
        req.method === "POST"
          ? apiError(409, "conflict", "already pausing")
          : apiError(404, "not_found", "gone"),
    })
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).status).toBe("deleted")
  })
})

describe("ID-shaped names", () => {
  test("create rejects a name that would be read as an ID", async () => {
    for (const name of [SANDBOX_ID, `sb-usw-${SANDBOX_ID}`]) {
      const r = await runCli(["sandbox", "create", "--name", name])
      expect(r.exitCode).toBe(2)
      expect(r.requests).toHaveLength(0)
    }
  })
})

describe("edge inputs", () => {
  test("--metadata __proto__=x reaches the API as a real key", async () => {
    const r = await runCli(
      ["sandbox", "update", SANDBOX_ID, "-m", "__proto__=x"],
      {
        fetch: () => new Response(null, { status: 204 }),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].body).toContain('"__proto__":"x"')
  })

  test("resume retries when a conflict turns out to be a finished pause", async () => {
    let posts = 0
    const r = await runCli(["sandbox", "resume", SANDBOX_ID], {
      fetch: (req) => {
        if (req.method === "POST")
          return ++posts === 1
            ? apiError(409, "conflict", "busy")
            : json({ id: SANDBOX_ID, name: "box", status: "active" })
        return json({ id: SANDBOX_ID, name: "box", status: "paused" })
      },
    })
    expect(r.exitCode).toBe(0)
    expect(posts).toBe(2)
  })
})

describe("new account setup", () => {
  const ineligible = () =>
    apiError(
      402,
      "billing_ineligible",
      "Sandbox usage is unavailable until billing is active",
    )

  test("right after login, a 402 waits for the account to finish setting up", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "ss-fresh-"))
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ api_key: TEST_KEY, setup_until: Date.now() + 60_000 }),
    )
    let posts = 0
    const r = await runCli(["sandbox", "create", "--name", "first"], {
      env: { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir },
      fetch: () =>
        ++posts === 1
          ? ineligible()
          : json({ id: SANDBOX_ID, name: "first", status: "active" }, 201),
    })
    expect(r.exitCode).toBe(0)
    expect(posts).toBe(2)
    expect(r.stderr).toContain("Finishing account setup")
  })

  test("a saved key without the signup marker (--with-key) fails right away", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "ss-withkey-"))
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ api_key: TEST_KEY }),
    )
    const r = await runCli(["sandbox", "create", "--name", "x"], {
      env: { SUPERSERVE_API_KEY: undefined, SUPERSERVE_CONFIG_DIR: dir },
      fetch: () => ineligible(),
    })
    expect(r.exitCode).not.toBe(0)
    expect(r.requests).toHaveLength(1)
  })

  test("without a fresh login, a 402 fails right away", async () => {
    const r = await runCli(["sandbox", "create", "--name", "x"], {
      fetch: () => ineligible(),
    })
    expect(r.exitCode).not.toBe(0)
    expect(r.requests).toHaveLength(1)
  })
})
