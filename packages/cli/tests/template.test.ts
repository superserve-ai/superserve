import { describe, expect, test } from "bun:test"

import { apiError, json, runCli } from "./harness"

const TPL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const BUILD = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

function sse(events: object[]): Response {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  )
}

const ts = "2026-01-01T00:00:00Z"
const row = (status: string) => ({
  id: TPL,
  team_id: "cccccccc-dddd-4eee-8fff-000000000000",
  name: "py-env",
  status,
  vcpu: 1,
  memory_mib: 1024,
  disk_mib: 4096,
  created_at: ts,
})

describe("template", () => {
  test("create keeps interleaved step order and maps sizes", async () => {
    const r = await runCli(
      [
        "template",
        "create",
        "py-env",
        "--from",
        "python:3.11",
        "--run",
        "apt-get update",
        "--env",
        "A=1=2",
        "--user",
        "app",
        "--sudo",
        "--workdir",
        "/srv",
        "--run",
        "pip install x",
        "--memory",
        "2G",
        "--disk",
        "8192",
        "--vcpu",
        "2",
        "--no-wait",
        "--json",
      ],
      {
        fetch: (req) =>
          req.method === "POST" && req.url.pathname === "/templates"
            ? json(
                {
                  id: TPL,
                  name: "py-env",
                  status: "building",
                  build_id: BUILD,
                },
                202,
              )
            : undefined,
      },
    )
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].json()).toEqual({
      name: "py-env",
      vcpu: 2,
      memory_mib: 2048,
      disk_mib: 8192,
      build_spec: {
        from: "python:3.11",
        steps: [
          { run: "apt-get update" },
          { env: { key: "A", value: "1=2" } },
          { user: { name: "app", sudo: true } },
          { workdir: "/srv" },
          { run: "pip install x" },
        ],
      },
    })
    expect(JSON.parse(r.stdout).build_id).toBe(BUILD)
  })

  test("invalid input is rejected before any request", async () => {
    for (const args of [
      ["template", "create", "Bad_Name", "--from", "x"],
      ["template", "create", "ok", "--from", "x", "--memory", "64"],
      ["template", "create", "ok"],
    ]) {
      const r = await runCli(args)
      expect(r.exitCode).toBe(2)
      expect(r.requests).toHaveLength(0)
    }
  })

  test("a failed build streams logs and exits non-zero with the error code", async () => {
    const r = await runCli(
      ["template", "create", "py-env", "--from", "python:3.11"],
      {
        fetch: (req) => {
          const p = req.url.pathname
          if (req.method === "POST")
            return json(
              { id: TPL, name: "py-env", status: "building", build_id: BUILD },
              202,
            )
          if (p === `/templates/${TPL}`) return json(row("failed"))
          if (p.endsWith("/logs"))
            return sse([
              { timestamp: ts, stream: "stdout", text: "installing\n" },
              {
                timestamp: ts,
                stream: "system",
                text: "step 1 failed",
                finished: true,
                status: "failed",
              },
            ])
          if (p === `/templates/${TPL}/builds/${BUILD}`)
            return json({
              id: BUILD,
              template_id: TPL,
              status: "failed",
              error_message: "step_failed: step 1/1 exited with code 1",
            })
        },
      },
    )
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("installing\n")
    expect(r.stderr).toContain("step 1 failed\n")
    expect(r.stderr).toContain(
      "Build failed (step_failed): step 1/1 exited with code 1",
    )
    expect(r.stdout).toBe("")
  })

  test("logs resolves a name to its latest running build and prints to stdout", async () => {
    const r = await runCli(["template", "logs", "py-env"], {
      fetch: (req) => {
        const p = req.url.pathname
        if (p === "/templates")
          return json([
            { id: "x", name: "py-env-2" },
            { id: TPL, name: "py-env" },
          ])
        if (p === `/templates/${TPL}/builds`)
          return json([{ id: BUILD, template_id: TPL, status: "building" }])
        if (p === `/templates/${TPL}`) return json(row("building"))
        if (p.endsWith(`/builds/${BUILD}/logs`))
          return sse([
            { timestamp: ts, stream: "stderr", text: "warn" },
            {
              timestamp: ts,
              stream: "system",
              text: "ready",
              finished: true,
              status: "ready",
            },
          ])
      },
    })
    expect(r.exitCode).toBe(0)
    expect(r.requests[0].url.searchParams.get("q")).toBe("py-env")
    expect(r.stdout).toContain("warn\n")
  })

  test("logs of a finished build explains that history isn't kept", async () => {
    // The server streams build logs live only; a finished build replays nothing.
    const r = await runCli(["template", "logs", TPL, "--build", BUILD], {
      fetch: (req) =>
        req.url.pathname === `/templates/${TPL}/builds/${BUILD}`
          ? json({
              id: BUILD,
              template_id: TPL,
              status: "failed",
              error_message: "step_failed: boom",
            })
          : undefined,
    })
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain("only available while a build runs")
    expect(r.stderr).toContain("step_failed: boom")
    expect(r.requests.some((q) => q.url.pathname.endsWith("/logs"))).toBe(false)
  })

  test("delete refuses without --yes and explains a 409", async () => {
    const noYes = await runCli(["template", "delete", TPL])
    expect(noYes.exitCode).toBe(2)
    expect(noYes.requests).toHaveLength(0)

    const r = await runCli(["template", "delete", TPL, "--yes"], {
      fetch: () =>
        apiError(409, "conflict", "template is referenced by 2 sandboxes"),
    })
    expect(r.exitCode).toBe(5)
    expect(r.stderr).toContain("template is referenced by 2 sandboxes")
  })

  test("wait --timeout 0 checks once instead of waiting forever", async () => {
    const r = await runCli(["template", "wait", TPL, "--timeout", "0"], {
      fetch: (req) => {
        const p = req.url.pathname
        if (p === `/templates/${TPL}/builds`)
          return json([{ id: BUILD, template_id: TPL, status: "building" }])
        if (p === `/templates/${TPL}/builds/${BUILD}`)
          return json({ id: BUILD, template_id: TPL, status: "building" })
        if (p === `/templates/${TPL}`) return json(row("building"))
      },
    })
    expect(r.exitCode).toBe(7)
  })
})
