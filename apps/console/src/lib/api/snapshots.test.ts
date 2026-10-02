import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createSnapshot,
  deleteSnapshot,
  listSandboxSnapshots,
  renameSnapshot,
} from "./snapshots"

const fetchSpy = vi.fn()
vi.stubGlobal("fetch", fetchSpy)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

describe("snapshots api", () => {
  afterEach(() => {
    fetchSpy.mockReset()
    vi.useRealTimers()
  })

  it("createSnapshot POSTs a mem+fs capture with a fresh idempotency key", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(json({ id: "snap-1", status: "ready" }, 201)),
    )
    await createSnapshot("sbx-1", { name: "before-upgrade" })
    await createSnapshot("sbx-1")

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/sandboxes/sbx-1/snapshot/")
    expect(init.method).toBe("POST")
    const first = JSON.parse(init.body as string)
    expect(first).toMatchObject({ kind: "mem+fs", name: "before-upgrade" })
    expect(first.idempotency_key).toEqual(expect.any(String))

    const second = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string,
    )
    expect(second).not.toHaveProperty("name")
    expect(second.idempotency_key).not.toBe(first.idempotency_key)
  })

  it("createSnapshot outlives the default 30s request timeout", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise(() => {})
    })
    void createSnapshot("sbx-1")

    await vi.advanceTimersByTimeAsync(60_000)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(signal?.aborted).toBe(true)
  })

  it("listSandboxSnapshots GETs the sandbox's snapshots", async () => {
    fetchSpy.mockResolvedValue(json([{ id: "snap-1" }]))
    const list = await listSandboxSnapshots("sbx-1")

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/sandboxes/sbx-1/snapshots/")
    expect(list).toEqual([{ id: "snap-1" }])
  })

  it("renameSnapshot PATCHes the name", async () => {
    fetchSpy.mockResolvedValue(json({ id: "snap-1", name: "renamed" }))
    await renameSnapshot("snap-1", "renamed")

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/snapshots/snap-1/")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ name: "renamed" })
  })

  it("deleteSnapshot resolves on 204 and on 202", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteSnapshot("snap-1")).resolves.toBeUndefined()

    fetchSpy.mockResolvedValueOnce(json({ status: "deleting" }, 202))
    await expect(deleteSnapshot("snap-2")).resolves.toBeUndefined()

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("/api/snapshots/snap-2/")
    expect(init.method).toBe("DELETE")
  })
})
