import { createServer } from "node:http"
import { inspect } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, ValidationError } from "../src/errors.js"
import { Provider } from "../src/Provider.js"
import { Sandbox } from "../src/Sandbox.js"
import { resolveSandboxConfig } from "../src/sandboxConfig.js"
import { Secret } from "../src/Secret.js"
import { Snapshot } from "../src/Snapshot.js"
import { Template } from "../src/Template.js"

const root = "machine-root-for-test"
const child = "mcap.v1.opaque-payload.opaque-signature"
const id = "us-west-2-12345678-1234-1234-1234-123456789abc"
const options = {
  machineCredential: root,
  baseUrl: "https://api-usw.superserve.ai",
}
const info = {
  id,
  name: "test",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  access_token: child,
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const denied = (status = 403, value = root) =>
  json({ error: { code: value, message: `Rejected ${value}` } }, status)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("explicit machine mode", () => {
  it("requires a nonempty credential and explicit safe origin without falling back to environment", () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "ordinary-environment-key")
    vi.stubEnv("SUPERSERVE_BASE_URL", options.baseUrl)
    expect(resolveSandboxConfig(options)).toMatchObject({
      machineCredential: root,
      sandboxHost: "usw-sandbox.superserve.ai",
    })
    expect(resolveSandboxConfig(options)).not.toHaveProperty("apiKey")
    for (const override of [
      { apiKey: "ordinary" },
      { apiKey: "" },
      { machineCredential: "" },
      { machineCredential: " root " },
      { machineCredential: "bad\nheader" },
      { baseUrl: undefined },
      { baseUrl: "" },
      { baseUrl: "http://example.com" },
      { baseUrl: "https://user:pass@example.com" },
      { baseUrl: "https://example.com/internal" },
      { baseUrl: "https://example.com?query" },
      { baseUrl: "https://example.com#fragment" },
    ])
      expect(() => resolveSandboxConfig({ ...options, ...override })).toThrow(
        ValidationError,
      )
  })

  it("requires a data-plane host for unknown origins before any request", async () => {
    const mock = vi.fn()
    vi.stubGlobal("fetch", mock)
    for (const baseUrl of [
      "https://custom.example",
      "http://localhost:1234",
      "https://api.superserve.ai:444",
    ]) {
      await expect(
        Sandbox.connect(id, { machineCredential: root, baseUrl }),
      ).rejects.toThrow("requires an explicit sandboxHost")
    }
    for (const sandboxHost of [
      "",
      "https://sandbox.example",
      "user@sandbox.example",
      "sandbox.example:443",
      "sandbox.example/path",
      "sandbox.example?x",
      "sandbox.example#x",
      "sandbox.example\n",
      "-sandbox.example",
      "sandbox..example",
      "127.0.0.1",
      "123",
      "0x7f000001",
      "sandbox.123",
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(62)}`,
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
    ]) {
      await expect(
        Sandbox.connect(id, { ...options, sandboxHost }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
    expect(mock).not.toHaveBeenCalled()
    const longestSuffix = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(61)}`
    expect(
      resolveSandboxConfig({
        ...options,
        baseUrl: "https://custom.example",
        sandboxHost: longestSuffix,
      }).sandboxHost,
    ).toBe(longestSuffix)
    expect(`${"x".repeat(63)}.${longestSuffix}`).toHaveLength(253)
    expect(
      resolveSandboxConfig({
        ...options,
        baseUrl: "https://api-staging.superserve.ai",
      }).sandboxHost,
    ).toBe("staging-sandbox.superserve.ai")
  })

  it("routes custom-origin file and command requests only to the explicit data-plane host", async () => {
    const mock = vi.fn(async (url: string) =>
      url.startsWith("https://control.example")
        ? json(info)
        : url.endsWith("/exec")
          ? json({ stdout: "ok", stderr: "", exit_code: 0 })
          : new Response("file"),
    )
    vi.stubGlobal("fetch", mock)
    const box = await Sandbox.connect(id, {
      machineCredential: root,
      baseUrl: "https://control.example",
      sandboxHost: "sandbox.example",
    })
    expect(await box.files.readText("/tmp/test")).toBe("file")
    expect((await box.commands.run("true")).stdout).toBe("ok")
    for (const [url, init] of (
      mock.mock.calls as unknown as Array<[string, RequestInit]>
    ).slice(1)) {
      expect(new URL(url).hostname).toBe(`boxd-${id}.sandbox.example`)
      expect(new Headers(init.headers).get("X-Access-Token")).toBe(child)
      expect(new Headers(init.headers).has("X-QM-Machine-Credential")).toBe(
        false,
      )
    }
  })

  it("retains machine mode on every lifecycle operation and preserves the full regional id", async () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "ambient-key")
    const calls: Array<[string, RequestInit]> = []
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      if (init.method === "DELETE" || init.method === "PATCH")
        return new Response(null, { status: 204 })
      if (url.includes("?")) return json([info])
      return json(info)
    })
    vi.stubGlobal("fetch", fetcher)
    const box = await Sandbox.create({
      ...options,
      name: "test",
      fromTemplate: "approved-template",
    })
    await Sandbox.connect(id, options)
    await Sandbox.list({ ...options, metadata: { test: "yes" } })
    await Sandbox.updateById(id, { metadata: { test: "yes" } }, options)
    await Sandbox.killById(id, options)
    await box.getInfo()
    await box.update({ metadata: { test: "yes" } })
    await box.pause()
    await box.pause({ wait: true })
    await box.resume()
    await box.kill()
    expect(calls).toHaveLength(11)
    for (const [url, init] of calls) {
      expect(init.headers).toMatchObject({ "X-QM-Machine-Credential": root })
      expect(new Headers(init.headers).has("X-API-Key")).toBe(false)
      expect(new Headers(init.headers).has("Authorization")).toBe(false)
      expect(init.redirect).toBe("error")
      if (!url.endsWith("/sandboxes") && !url.includes("?"))
        expect(url).toContain(`/sandboxes/${id}`)
    }
  })

  it("keeps machine authority for pause polling and resume conflict recovery", async () => {
    const responses = [
      json(info),
      json({ status: "pausing" }),
      json({ ...info, status: "paused" }),
      json({ error: { message: "pausing" } }, 409),
      json({ ...info, status: "paused" }),
      json(info),
    ]
    const mock = vi.fn(async () => responses.shift()!)
    vi.stubGlobal("fetch", mock)
    const box = await Sandbox.connect(id, options)
    await box.pause({ wait: true, pollIntervalMs: 1 })
    await box.resume()
    expect(mock).toHaveBeenCalledTimes(6)
    for (const call of mock.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(call[1].headers).toMatchObject({ "X-QM-Machine-Credential": root })
    }
  })

  it("rejects unsupported services, paths, snapshots and previews before sending", async () => {
    vi.stubEnv("SUPERSERVE_API_KEY", "ambient-key")
    const mock = vi.fn(async () => json(info))
    vi.stubGlobal("fetch", mock)
    const box = await Sandbox.connect(id, options)
    mock.mockClear()
    for (const operation of [
      () => Template.list(options),
      () => Secret.list(options),
      () => Provider.list(options),
      () => Snapshot.list(id, options),
      () => box.snapshot(),
      () => box.snapshots(),
      () => box.desktop.getStreamUrl(),
      () => box.desktop.screenshot(),
      () => box.listPreviewPorts(),
      () => box.publishPreviewPort(3000),
      () => box.unpublishPreviewPort(3000),
      () => box.getPreviewToken(3000),
      () => box.rotatePreviewToken(3000),
      () => box.getNetworkLog(),
      () => box.attachSecret("KEY", "secret"),
      () => box.detachSecret("KEY"),
      ...[
        "../internal/machine-identity",
        "x/../../internal",
        "%2e%2e",
        "x?query",
        "x#fragment",
        "x\\evil",
      ].map((bad) => () => Sandbox.connect(bad, options)),
    ])
      await expect(operation()).rejects.toBeInstanceOf(ValidationError)
    expect(mock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 503])(
    "does not retry create or switch auth on HTTP %s",
    async (status) => {
      const mock = vi.fn(async () => denied(status))
      vi.stubGlobal("fetch", mock)
      await expect(
        Sandbox.create({ ...options, name: "test" }),
      ).rejects.toThrow("Rejected [REDACTED]")
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it("does not retry an uncertain create and removes credentials from transport causes", async () => {
    const mock = vi.fn(async () => {
      throw new Error(`lost response ${root}`)
    })
    vi.stubGlobal("fetch", mock)
    const error = await Sandbox.create({ ...options, name: "test" }).catch(
      (error) => error,
    )
    expect(inspect(error)).not.toContain(root)
    expect(error.cause).toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])(
    "keeps typed errors and does not retry lifecycle auth failures (%s)",
    async (status) => {
      const mock = vi.fn(async () => denied(status))
      vi.stubGlobal("fetch", mock)
      const error = await Sandbox.list(options).catch((error) => error)
      expect(error).toBeInstanceOf(AuthenticationError)
      expect(error.statusCode).toBe(status)
      expect(inspect(error)).not.toContain(root)
      expect(error.code).toBe("[REDACTED]")
      expect(mock).toHaveBeenCalledTimes(1)
    },
  )

  it("uses opaque child tokens for commands/files and machine credentials only for activation", async () => {
    let stale = true
    const mock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith(options.baseUrl))
        return json({ ...info, access_token: stale ? child : `${child}-new` })
      if (url.endsWith("/exec")) {
        if (stale) {
          stale = false
          return denied(401, child)
        }
        return json({ stdout: "ok", stderr: "", exit_code: 0 })
      }
      return init.method === "POST"
        ? new Response(null, { status: 204 })
        : new Response("file")
    })
    vi.stubGlobal("fetch", mock)
    const box = await Sandbox.connect(id, options)
    expect((await box.commands.run("echo ok")).stdout).toBe("ok")
    await box.files.write("/tmp/test", "data")
    expect(await box.files.readText("/tmp/test")).toBe("file")
    const control = mock.mock.calls.filter(([url]) =>
      url.startsWith(options.baseUrl),
    )
    const data = mock.mock.calls.filter(
      ([url]) => !url.startsWith(options.baseUrl),
    )
    expect(control).toHaveLength(2)
    expect(data).toHaveLength(4)
    for (const [, init] of control)
      expect(init.headers).toMatchObject({ "X-QM-Machine-Credential": root })
    for (const [url, init] of data) {
      expect(JSON.stringify([url, init])).not.toContain(root)
      expect(new Headers(init.headers).get("X-Access-Token")).toMatch(
        /^mcap\.v1\./,
      )
      expect(new Headers(init.headers).has("X-API-Key")).toBe(false)
      expect(new Headers(init.headers).has("X-QM-Machine-Credential")).toBe(
        false,
      )
      expect(new Headers(init.headers).get("X-Superserve-Sandbox-Id")).toBe(id)
    }
  })

  it.each(["read", "write", "command", "stream"])(
    "redacts opaque tokens from %s errors",
    async (operation) => {
      const mock = vi.fn(async (url: string) =>
        url.startsWith(options.baseUrl) ? json(info) : denied(403, child),
      )
      vi.stubGlobal("fetch", mock)
      const box = await Sandbox.connect(id, options)
      const result =
        operation === "read"
          ? box.files.read("/tmp/test")
          : operation === "write"
            ? box.files.write("/tmp/test", "value")
            : box.commands.run(
                "true",
                operation === "stream" ? { onStdout: () => {} } : {},
              )
      const error = await result.catch((error) => error)
      expect(error).toBeInstanceOf(AuthenticationError)
      expect(inspect(error)).not.toContain(child)
    },
  )

  it("refuses a real HTTP redirect without sending the root to the destination", async () => {
    const requests: string[] = []
    const server = createServer((req, res) => {
      requests.push(req.url!)
      if (req.url === "/sandboxes") {
        expect(req.headers["x-qm-machine-credential"]).toBe(root)
        res.writeHead(302, { Location: "/internal/machine-identity" }).end()
      } else res.end("unexpected")
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address() as { port: number }
    try {
      await expect(
        Sandbox.create({
          ...options,
          baseUrl: `http://127.0.0.1:${address.port}`,
          sandboxHost: "sandbox.localhost",
          name: "test",
        }),
      ).rejects.toThrow()
      expect(requests).toEqual(["/sandboxes"])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
