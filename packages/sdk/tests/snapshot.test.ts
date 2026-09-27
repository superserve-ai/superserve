import { afterEach, describe, expect, it, vi } from "vitest"

import { SandboxError, TimeoutError } from "../src/errors.js"
import { Sandbox } from "../src/Sandbox.js"
import { Snapshot } from "../src/Snapshot.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(status: number, code = "error"): Response {
  return new Response(JSON.stringify({ error: { code, message: "boom" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const commonOpts = {
  apiKey: "ss_live_test",
  baseUrl: "https://api.superserve.ai",
}

const baseSandbox = {
  id: "sbx-1",
  name: "my-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 2048,
  access_token: "tok-abc",
  created_at: "2026-01-01T00:00:00.000Z",
  metadata: {},
}

function snapshotBody(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    sandbox_id: "sbx-1",
    template_id: "tpl-1",
    kind: "mem+fs",
    status,
    name: "before-upgrade",
    size_bytes: status === "ready" ? 4096 : 0,
    resources: { vcpu_count: 2, memory_mib: 2048, disk_mib: 8192 },
    created_at: "2026-01-02T00:00:00.000Z",
    ready_at: status === "ready" ? "2026-01-02T00:00:01.000Z" : null,
    ...extra,
  }
}

type Call = { url: string; method: string; body?: unknown }

function routeFetch(handler: (call: Call) => Response): { calls: Call[] } {
  const calls: Call[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      return handler(call)
    }),
  )
  return { calls }
}

async function makeSandbox(): Promise<Sandbox> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(baseSandbox)),
  )
  return Sandbox.create({ ...commonOpts, name: "my-sandbox" })
}

describe("Sandbox#snapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("captures with a generated idempotency key and returns the ready snapshot", async () => {
    const sandbox = await makeSandbox()
    const { calls } = routeFetch(() => jsonResponse(snapshotBody("ready"), 201))

    const snap = await sandbox.snapshot({ name: "before-upgrade" })

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url).toBe(
      "https://api.superserve.ai/sandboxes/sbx-1/snapshot",
    )
    const body = calls[0].body as Record<string, unknown>
    expect(body.kind).toBe("mem+fs")
    expect(body.name).toBe("before-upgrade")
    expect(typeof body.idempotency_key).toBe("string")
    expect(snap.id).toBe("snap-1")
    expect(snap.status).toBe("ready")
    expect(snap.sizeBytes).toBe(4096)
    expect(snap.resources).toEqual({
      vcpuCount: 2,
      memoryMib: 2048,
      diskMib: 8192,
    })
    expect(snap.readyAt).toBeInstanceOf(Date)
  })

  it("keeps a caller's idempotency key", async () => {
    const sandbox = await makeSandbox()
    const { calls } = routeFetch(() => jsonResponse(snapshotBody("ready"), 200))
    await sandbox.snapshot({ idempotencyKey: "deploy-42" })
    expect((calls[0].body as Record<string, unknown>).idempotency_key).toBe(
      "deploy-42",
    )
  })

  it("polls a snapshot still being settled until it is ready", async () => {
    const sandbox = await makeSandbox()
    let gets = 0
    const { calls } = routeFetch((call) => {
      if (call.method === "POST")
        return jsonResponse(snapshotBody("creating"), 202)
      gets++
      return jsonResponse(snapshotBody(gets < 2 ? "creating" : "ready"))
    })

    const snap = await sandbox.snapshot({ pollIntervalMs: 1 })

    expect(snap.status).toBe("ready")
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2)
    expect(calls[1].url).toBe("https://api.superserve.ai/snapshots/snap-1")
  })

  it("returns a settling snapshot as is when asked not to wait", async () => {
    const sandbox = await makeSandbox()
    const { calls } = routeFetch(() =>
      jsonResponse(snapshotBody("creating"), 202),
    )
    const snap = await sandbox.snapshot({ wait: false })
    expect(snap.status).toBe("creating")
    expect(calls).toHaveLength(1)
  })

  it("throws when the snapshot fails while waiting", async () => {
    const sandbox = await makeSandbox()
    routeFetch((call) =>
      call.method === "POST"
        ? jsonResponse(snapshotBody("creating"), 202)
        : jsonResponse(snapshotBody("failed")),
    )
    await expect(sandbox.snapshot({ pollIntervalMs: 1 })).rejects.toThrow(
      SandboxError,
    )
  })

  it("times out when the snapshot is still settling", async () => {
    const sandbox = await makeSandbox()
    routeFetch((call) =>
      call.method === "POST"
        ? jsonResponse(snapshotBody("creating"), 202)
        : jsonResponse(snapshotBody("creating")),
    )
    await expect(
      sandbox.snapshot({ timeoutMs: 30, pollIntervalMs: 1 }),
    ).rejects.toThrow(TimeoutError)
  })

  it("lists the sandbox's snapshots with paging", async () => {
    const sandbox = await makeSandbox()
    const { calls } = routeFetch(() =>
      jsonResponse([
        snapshotBody("ready"),
        snapshotBody("creating", { id: "snap-2" }),
      ]),
    )
    const list = await sandbox.snapshots({ limit: 2, offset: 4 })
    expect(calls[0].url).toBe(
      "https://api.superserve.ai/sandboxes/sbx-1/snapshots?limit=2&offset=4",
    )
    expect(list.map((s) => s.id)).toEqual(["snap-1", "snap-2"])
  })
})

describe("Snapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("renames, and deletes idempotently", async () => {
    let deleted = false
    const { calls } = routeFetch((call) => {
      if (call.method === "GET") return jsonResponse(snapshotBody("ready"))
      if (call.method === "PATCH")
        return jsonResponse(snapshotBody("ready", { name: "golden" }))
      if (!deleted) {
        deleted = true
        return new Response(null, { status: 202 })
      }
      return errorResponse(404, "not_found")
    })

    const snap = await Snapshot.get("snap-1", commonOpts)
    const renamed = await snap.rename("golden")
    expect(renamed.name).toBe("golden")
    expect(calls[1].body).toEqual({ name: "golden" })

    await snap.delete()
    await snap.delete()
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2)
  })
})

describe("Sandbox.create fromSnapshot", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends a Snapshot instance's id and reads the source back", async () => {
    routeFetch(() => jsonResponse(snapshotBody("ready")))
    const snap = await Snapshot.get("snap-1", commonOpts)

    const { calls } = routeFetch(() =>
      jsonResponse({ ...baseSandbox, source_snapshot_id: "snap-1" }, 201),
    )
    const fork = await Sandbox.create({
      ...commonOpts,
      name: "fork",
      fromSnapshot: snap,
    })

    expect((calls[0].body as Record<string, unknown>).from_snapshot).toBe(
      "snap-1",
    )
    expect((await fork.getInfo()).sourceSnapshotId).toBe("snap-1")
  })
})
