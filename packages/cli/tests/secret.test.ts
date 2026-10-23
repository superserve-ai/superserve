import { describe, expect, test } from "bun:test"

import { json, runCli, SANDBOX_ID } from "./harness"

const VALUE = "sk-test-0123456789abcdef"
const providers = [
  {
    name: "openai",
    display: "OpenAI",
    auth_type: "bearer",
    hosts: ["api.openai.com"],
    token_shape: "sk-...",
  },
]
const created = {
  id: "s1",
  name: "oa",
  auth_type: "bearer",
  auth_config: {},
  hosts: ["api.openai.com"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

describe("secret", () => {
  test("create sends the piped value only in the request body", async () => {
    const r = await runCli(["secret", "create", "oa", "--provider", "openai"], {
      stdin: `${VALUE}\n`,
      fetch: (req) =>
        req.url.pathname === "/providers"
          ? json(providers)
          : req.method === "POST"
            ? json(created, 201)
            : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[1].json()).toEqual({
      name: "oa",
      value: VALUE,
      provider: "openai",
    })
    expect(r.stdout + r.stderr).not.toContain(VALUE)
  })

  test("a provider typo suggests the close match and never reads or sends the value", async () => {
    const r = await runCli(["secret", "create", "oa", "--provider", "opanai"], {
      stdin: VALUE,
      fetch: (req) =>
        req.url.pathname === "/providers" ? json(providers) : undefined,
    })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain("Did you mean openai?")
    expect(r.requests).toHaveLength(1)
    expect(r.stderr).not.toContain(VALUE)
  })

  test("provider and custom auth are mutually exclusive", async () => {
    const r = await runCli(
      [
        "secret",
        "create",
        "x",
        "--provider",
        "openai",
        "--host",
        "a.example.com",
      ],
      { stdin: VALUE },
    )
    expect(r.exitCode).toBe(2)
    expect(r.requests).toHaveLength(0)
  })

  test("custom auth flags map to the API auth object", async () => {
    const r = await runCli(
      [
        "secret",
        "create",
        "x",
        "--host",
        "api.example.com",
        "--auth",
        "custom",
        "--header-template",
        "X-Token: tok {{ value }}",
      ],
      { stdin: VALUE, fetch: () => json(created, 201) },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].json()).toEqual({
      name: "x",
      value: VALUE,
      hosts: ["api.example.com"],
      auth: { type: "custom", headers: { "X-Token": "tok {{ value }}" } },
    })
  })

  test("attach resolves the sandbox name and posts the binding", async () => {
    const r = await runCli(
      ["secret", "attach", "agent", "OPENAI_API_KEY", "oa", "--json"],
      {
        fetch: (req) =>
          req.url.pathname === "/sandboxes"
            ? json([{ id: SANDBOX_ID, name: "agent", status: "paused" }])
            : json({ env_key: "OPENAI_API_KEY", secret_name: "oa" }, 201),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[1].url.pathname).toBe(`/sandboxes/${SANDBOX_ID}/secrets`)
    expect(r.requests[1].json()).toEqual({
      env_key: "OPENAI_API_KEY",
      secret_name: "oa",
    })
  })

  test("audit --all pages with the last id as the cursor", async () => {
    const ev = (id: number) => ({
      id,
      ts: "2026-01-01T00:00:00Z",
      sandbox_id: SANDBOX_ID,
      method: "GET",
      host: "h",
      path: "/",
      status: 200,
    })
    const r = await runCli(
      ["secret", "audit", "oa", "--all", "--limit", "2", "--json"],
      {
        fetch: (req) =>
          json(req.url.searchParams.get("before") ? [ev(3)] : [ev(5), ev(4)]),
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[1].url.searchParams.get("before")).toBe("4")
    expect(JSON.parse(r.stdout).map((e: { id: number }) => e.id)).toEqual([
      5, 4, 3,
    ])
  })
})

describe("provider list", () => {
  test("a minimal provider row still renders", async () => {
    const r = await runCli(["provider", "list"], {
      fetch: () => json([{ name: "example" }]),
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("example")
  })
})
