import { afterEach, expect, it, vi } from "vitest"

import { SandboxError, ServerError, NotFoundError } from "../src/errors.js"
import { Sandbox } from "../src/Sandbox.js"
import { withTokenRetry } from "../src/tokenRetry.js"

const info = {
  id: "sbx-1",
  name: "example",
  status: "active",
  vcpu_count: 2,
  memory_mib: 512,
  access_token: "auth",
  created_at: "2026-01-01T00:00:00Z",
  metadata: {},
}
const opts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.example.com",
  sandboxHost: "sandbox.example.com",
  name: "example",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
afterEach(() => vi.unstubAllGlobals())

it("carries fresh create/resume hints on commands and files, and clears absent hints on old responses", async () => {
  let hint: string | undefined = "create-hint"
  const sent: Array<Record<string, string>> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("api.example.com"))
        return json({ ...info, routing_hint: hint })
      sent.push(init.headers as Record<string, string>)
      return json({ stdout: "ok", exit_code: 0 })
    }),
  )
  const sandbox = await Sandbox.create(opts)
  await sandbox.commands.run("echo ok")
  hint = "resume-hint"
  await sandbox.resume()
  await sandbox.files.write("/tmp/test", "hello")
  hint = undefined
  await sandbox.resume()
  await sandbox.commands.run("echo ok")
  expect(sent.map((h) => h["X-Superserve-Routing-Hint"])).toEqual([
    "create-hint",
    "resume-hint",
    undefined,
  ])
  expect(sent.map((h) => h["X-Access-Token"])).toEqual(["auth", "auth", "auth"])
})

it.each([
  [404, "sandbox_route_stale"],
  [503, "sandbox_unavailable"],
] as const)(
  "refreshes a proven pre-dispatch %s/%s only once",
  async (status, code) => {
    let activates = 0,
      executions = 0
    const hints: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("api.example.com"))
          return json({ ...info, routing_hint: `hint-${++activates}` })
        hints.push(
          (init.headers as Record<string, string>)[
            "X-Superserve-Routing-Hint"
          ]!,
        )
        executions++
        return executions === 1
          ? json({ error: { code } }, status)
          : json({ exit_code: 0 })
      }),
    )
    const sandbox = await Sandbox.connect("sbx-1", opts)
    await sandbox.commands.run("echo once")
    expect(activates).toBe(2)
    expect(executions).toBe(2)
    expect(hints).toEqual(["hint-1", "hint-2"])
  },
)

it.each([
  new SandboxError("connection lost"),
  new ServerError("gateway", undefined, 502),
  new ServerError("ambiguous upstream", undefined, 503),
  new NotFoundError("file missing"),
])("does not replay an ambiguous or unrelated failure: %s", async (error) => {
  const send = vi.fn().mockRejectedValue(error),
    refreshActivate = vi.fn()
  await expect(
    withTokenRetry(
      {
        getAccessToken: () => "auth",
        getRoutingHint: () => "hint",
        refreshActivate,
      },
      send,
    ),
  ).rejects.toBe(error)
  expect(send).toHaveBeenCalledTimes(1)
  expect(refreshActivate).not.toHaveBeenCalled()
})

it("refreshes an expired hint before dispatch, without replaying a command", async () => {
  let hint = "v1." + btoa(JSON.stringify({ e: 1 })) + ".signature"
  const refreshActivate = vi.fn(async () => {
    hint = "fresh"
    return "auth"
  })
  const send = vi.fn(async () => hint)
  expect(
    await withTokenRetry(
      {
        getAccessToken: () => "auth",
        getRoutingHint: () => hint,
        refreshActivate,
      },
      send,
    ),
  ).toBe("fresh")
  expect(send).toHaveBeenCalledTimes(1)
  expect(refreshActivate).toHaveBeenCalledTimes(1)
})

it("a delayed resume response cannot overwrite a newer hint", async () => {
  let resolveFirst!: (value: Response) => void
  let calls = 0
  const hints: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("api.example.com")) {
        calls++
        if (calls === 2)
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve
          })
        return json({
          ...info,
          routing_hint: calls === 1 ? "initial" : "newer",
        })
      }
      hints.push(
        (init.headers as Record<string, string>)["X-Superserve-Routing-Hint"]!,
      )
      return json({ exit_code: 0 })
    }),
  )
  const sandbox = await Sandbox.create(opts)
  const first = sandbox.resume()
  await Promise.resolve()
  await sandbox.resume()
  resolveFirst(json({ ...info, routing_hint: "older" }))
  await first
  await sandbox.commands.run("echo once")
  expect(hints).toEqual(["newer"])
})

it("uses dispatch-specific retry safety when a concurrent refresh clears the hint", async () => {
  let hint: string | undefined = "signed"
  const refreshActivate = vi.fn()
  const send = vi.fn(async () => {
    hint = undefined
    throw new ServerError("ambiguous", undefined, 503)
  })
  await expect(
    withTokenRetry(
      {
        getAccessToken: () => "auth",
        getRoutingHint: () => hint,
        refreshActivate,
      },
      send,
    ),
  ).rejects.toThrow("ambiguous")
  expect(send).toHaveBeenCalledTimes(1)
  expect(refreshActivate).not.toHaveBeenCalled()
})

it("does not discard an earlier successful resume when a later resume fails", async () => {
  let resolveFirst!: (r: Response) => void
  let calls = 0
  const hints: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("api.example.com")) {
        calls++
        if (calls === 1) return json({ ...info, routing_hint: "old" })
        if (calls === 2)
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve
          })
        return json({ error: { message: "failed" } }, 400)
      }
      hints.push(
        (init.headers as Record<string, string>)["X-Superserve-Routing-Hint"]!,
      )
      return json({ exit_code: 0 })
    }),
  )
  const sb = await Sandbox.create(opts)
  const first = sb.resume()
  await Promise.resolve()
  await expect(sb.resume()).rejects.toThrow("failed")
  resolveFirst(json({ ...info, routing_hint: "fresh" }))
  await first
  await sb.commands.run("echo once")
  expect(hints).toEqual(["fresh"])
})

it("streaming command carries refreshed hints without repeating delivered output", async () => {
  let lifecycle = 0,
    stream = 0
  const hints: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("api.example.com"))
        return json({
          ...info,
          routing_hint: ++lifecycle === 1 ? "old" : "fresh",
        })
      hints.push(
        (init.headers as Record<string, string>)["X-Superserve-Routing-Hint"]!,
      )
      if (++stream === 1)
        return json({ error: { code: "sandbox_route_stale" } }, 404)
      return new Response(
        'data: {"stdout":"ok","finished":true,"exit_code":0}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      )
    }),
  )
  const sb = await Sandbox.create(opts)
  const output: string[] = []
  await sb.commands.run("echo once", { onStdout: (s) => output.push(s) })
  expect(output).toEqual(["ok"])
  expect(hints).toEqual(["old", "fresh"])
})

it.each(["read", "downloadDir"] as const)(
  "file %s carries the current routing hint",
  async (method) => {
    const requests: RequestInit[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("api.example.com"))
          return json({ ...info, routing_hint: "current" })
        requests.push(init)
        return new Response("file bytes")
      }),
    )
    const sb = await Sandbox.create(opts)
    expect(
      new TextDecoder().decode(await sb.files[method]("/tmp/example")),
    ).toBe("file bytes")
    expect(requests).toHaveLength(1)
    expect(requests[0].headers).toMatchObject({
      "X-Superserve-Routing-Hint": "current",
      "X-Access-Token": "auth",
    })
  },
)

it.each(["paused", "stopped"])(
  "auto-resumes through an old proxy reporting %s",
  async (state) => {
    let lifecycle = 0,
      commands = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.example.com"))
          return json({ ...info, routing_hint: `hint-${++lifecycle}` })
        if (++commands === 1)
          return new Response(`sandbox is ${state}\n`, {
            status: 503,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Content-Type-Options": "nosniff",
            },
          })
        return json({ stdout: "ok", exit_code: 0 })
      }),
    )
    const sb = await Sandbox.create(opts)
    expect((await sb.commands.run("echo once")).stdout).toBe("ok")
    expect(lifecycle).toBe(2)
    expect(commands).toBe(2)
  },
)

it.each([
  "sandbox is paused",
  "sandbox is paused\nextra",
  "upstream unavailable\n",
])("does not replay a legacy-looking ambiguous response: %s", async (body) => {
  let lifecycle = 0,
    commands = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("api.example.com"))
        return json({ ...info, routing_hint: `hint-${++lifecycle}` })
      commands++
      return new Response(body, {
        status: 503,
        headers: {
          "Content-Type": "text/plain",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }),
  )
  const sb = await Sandbox.create(opts)
  await expect(sb.commands.run("echo once")).rejects.toThrow()
  expect(lifecycle).toBe(1)
  expect(commands).toBe(1)
})
