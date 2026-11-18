import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ConflictError,
  Sandbox,
  TimeoutError,
  ValidationError,
  Volume,
} from "../src/index.js"
import { sameVolumeSandbox } from "../src/Volume.js"

const config = { apiKey: "example-key", baseUrl: "https://api.example.test" }
const volume = {
  id: "c6cb5b6b-c4d6-4269-8b78-b5533bcfa008",
  name: "data",
  capacity_bytes: 1073741824,
  used_bytes: 42,
  region: "example",
  status: "ready",
  generation: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
}
const sandbox = {
  id: "05609d7c-c59a-4f96-b7e5-0892a4260588",
  name: "example",
  status: "active",
  access_token: "example-token",
  created_at: volume.created_at,
}
const attachment = {
  id: "bdb16649-1ee4-4857-beb3-829921b6ea6d",
  volume_id: volume.id,
  sandbox_id: sandbox.id,
  mount_path: "/mnt/data",
  read_only: false,
  status: "mounted",
  generation: 1,
  lease_expires_at: "2026-01-03T00:00:00Z",
  created_at: volume.created_at,
  updated_at: volume.updated_at,
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
function fail() {
  return json({ error: { code: "volume_in_use", message: "busy" } }, 409)
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each(["too many", "duplicate paths"])(
  "rejects %s volume mounts before creating a guest",
  async (mode) => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const volumes =
      mode === "too many"
        ? Array.from({ length: 129 }, (_, i) => ({
            volume: "data",
            mountPath: `/mnt/data-${i}`,
          }))
        : [
            {
              volume: "data",
              mountPath: "/mnt/data",
              idempotencyKey: "repeated",
            },
            {
              volume: "data",
              mountPath: "/mnt/data",
              idempotencyKey: "repeated",
            },
          ]
    await expect(
      Sandbox.create({ ...config, name: "example", volumes }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetch).not.toHaveBeenCalled()
  },
)

describe("native volumes", () => {
  it.each([sandbox.id, sandbox.id.toUpperCase(), `sb-usw-${sandbox.id}`])(
    "accepts prefixed create with attachment sandbox ID %s without deleting its new guest",
    async (attachmentSandboxId) => {
      const tagged = `sb-usw-${sandbox.id}`
      const calls: { url: string; method?: string }[] = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          calls.push({ url, method: init.method })
          if (url.endsWith("/sandboxes"))
            return json({ ...sandbox, id: tagged })
          if (url.includes("/volume-attachments/")) {
            return init.method === "DELETE"
              ? new Response(null, { status: 204 })
              : json({ ...attachment, sandbox_id: attachmentSandboxId })
          }
          if (init.method === "GET") return json(volume)
          return json({ ...attachment, sandbox_id: attachmentSandboxId })
        }),
      )
      const guest = await Sandbox.create({
        ...config,
        name: "example",
        volumes: [{ volume: "data", mountPath: "/mnt/data" }],
      })
      expect(guest.id).toBe(tagged)
      expect(calls.some((call) => call.method === "DELETE")).toBe(false)
      expect(
        calls.some(
          (call) =>
            call.url === `${config.baseUrl}/sandboxes/${tagged}/volumes`,
        ),
      ).toBe(true)
      await guest.detachVolume(attachment.id)
      expect(calls.filter((call) => call.method === "DELETE")).toEqual([
        {
          url: `${config.baseUrl}/volume-attachments/${attachment.id}`,
          method: "DELETE",
        },
      ])
    },
  )

  it("accepts a legacy raw UUID input with a prefixed native attachment response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        json(
          init.method === "GET"
            ? volume
            : { ...attachment, sandbox_id: `sb-usw-${sandbox.id}` },
        ),
      ),
    )
    const handle = await Volume.connect("data", config)
    const result = await handle.attach(sandbox.id.toUpperCase(), {
      mountPath: "/mnt/data",
    })
    expect(result.sandboxId).toBe(`sb-usw-${sandbox.id}`)
  })

  it.each([
    "sb-usw-811f0680-f527-445c-b606-9ab9b93db454",
    `sb-use-${sandbox.id}`,
    `opaque-usw-${sandbox.id}`,
    `sb-us-west-${sandbox.id}`,
  ])(
    "rejects a different or unrecognized attachment sandbox ID %s",
    async (wrongId) => {
      const calls: string[] = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          calls.push(init.method ?? "")
          if (url.endsWith("/sandboxes"))
            return json({ ...sandbox, id: `sb-usw-${sandbox.id}` })
          if (url.includes("/volume-attachments/"))
            return json({ ...attachment, sandbox_id: wrongId })
          return json(
            init.method === "GET"
              ? volume
              : { ...attachment, sandbox_id: wrongId },
          )
        }),
      )
      const guest = await Sandbox.create({ ...config, name: "example" })
      await expect(
        guest.attachVolume("data", { mountPath: "/mnt/data" }),
      ).rejects.toThrow(/did not confirm/)
      await expect(guest.detachVolume(attachment.id)).rejects.toBeInstanceOf(
        ValidationError,
      )
      expect(calls).not.toContain("DELETE")
    },
  )

  it.each([
    ["opaque-id", "opaque-id", true],
    ["opaque-id", "different-opaque-id", false],
    [`prefix-${sandbox.id}`, sandbox.id, false],
    [sandbox.id + "\n", sandbox.id, false],
    [`sb-usw-${sandbox.id}`, `sb-use-${sandbox.id}`, false],
  ])("compares complete IDs %s and %s", (a, b, expected) => {
    expect(sameVolumeSandbox(a as string, b as string)).toBe(expected)
  })

  it("roundtrips native fields, dates, keys, attachment info and encoded names", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (init.method === "DELETE") return new Response(null, { status: 204 })
        if (url.endsWith("/attachments")) return json([attachment])
        if (url.includes("/volume-attachments/")) return json(attachment)
        if (url.includes("?limit=")) return json([volume])
        if (url.endsWith("/volumes") && url.includes("/sandboxes/"))
          return json(attachment)
        return json(volume)
      }),
    )
    const handle = await Volume.create({
      ...config,
      name: "data",
      capacityBytes: 1073741824,
      idempotencyKey: "stable-create",
    })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "data",
      capacity_bytes: 1073741824,
      idempotency_key: "stable-create",
    })
    expect(handle.createdAt).toEqual(new Date(volume.created_at))
    expect((await handle.getInfo()).usedBytes).toBe(42)
    expect((await Volume.list({ ...config, limit: 2 }))[0].updatedAt).toEqual(
      new Date(volume.updated_at),
    )
    const mounted = await handle.attach(sandbox.id, {
      mountPath: "/mnt/data",
      idempotencyKey: "stable-attach",
    })
    expect(mounted.leaseExpiresAt).toEqual(
      new Date(attachment.lease_expires_at),
    )
    expect((await handle.listAttachments())[0].sandboxId).toBe(sandbox.id)
    await handle.detach(attachment.id)
    await Volume.connect("data/with?#", config)
    await Volume.deleteById("data/with?#", config)
    expect(calls.at(-1)?.url).toBe(
      `${config.baseUrl}/volumes/data%2Fwith%3F%23`,
    )
    const second = await Volume.create({ ...config, name: "default" })
    expect(second.id).toBe(volume.id)
    const body = JSON.parse(calls.at(-1)!.init.body as string)
    expect(body.capacity_bytes).toBeUndefined()
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("mounts before returning a new sandbox without serializing volumes or creating storage", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    let finish!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (url.endsWith("/sandboxes")) return json(sandbox)
        if (init.method === "GET") return json(volume)
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      }),
    )
    let done = false
    const pending = Sandbox.create({
      ...config,
      name: "example",
      volumes: [{ volume: "data", mountPath: "/mnt/data" }],
    }).then((result) => {
      done = true
      return result
    })
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(done).toBe(false)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "example",
    })
    expect(JSON.parse(calls[2].init.body as string).volume_id).toBe(volume.id)
    finish(json(attachment))
    expect((await pending).id).toBe(sandbox.id)
    expect(
      calls.filter(
        (c) =>
          c.url === `${config.baseUrl}/volumes` && c.init.method === "POST",
      ),
    ).toHaveLength(0)
  })

  it("deletes only the newly created guest after partial mount failure", async () => {
    const methods: string[] = []
    let mounts = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        methods.push(`${init.method} ${url}`)
        if (init.method === "DELETE") return new Response(null, { status: 204 })
        if (url.endsWith("/sandboxes")) return json(sandbox)
        if (init.method === "GET") return json(volume)
        return ++mounts === 1 ? json(attachment) : fail()
      }),
    )
    await expect(
      Sandbox.create({
        ...config,
        name: "example",
        volumes: [
          { volume: "data", mountPath: "/mnt/data" },
          { volume: "other", mountPath: "/mnt/other" },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(methods.filter((m) => m.startsWith("DELETE"))).toEqual([
      `DELETE ${config.baseUrl}/sandboxes/${sandbox.id}`,
    ])
    expect(mounts).toBe(2)
  })

  it("keeps the no-volume create path to one unchanged request and guards cross-config handles", async () => {
    const fetcher = vi.fn(async (url: string) =>
      json(url.endsWith("/sandboxes") ? sandbox : volume),
    )
    vi.stubGlobal("fetch", fetcher)
    const guest = await Sandbox.create({ ...config, name: "example" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const foreign = await Volume.connect("data", {
      ...config,
      baseUrl: "https://other.example.test",
    })
    const wrongKey = await Volume.connect("data", {
      ...config,
      apiKey: "other-example-key",
    })
    const before = fetcher.mock.calls.length
    await expect(
      foreign.attach(guest, { mountPath: "/mnt/data" }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      guest.attachVolume(wrongKey, { mountPath: "/mnt/data" }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      Sandbox.create({
        ...config,
        name: "new",
        volumes: [{ volume: foreign, mountPath: "/mnt/data" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetcher).toHaveBeenCalledTimes(before)
  })

  it("does not retry terminal conflicts or uncertain POST network failures", async () => {
    const fetcher = vi.fn(async () => fail())
    vi.stubGlobal("fetch", fetcher)
    await expect(
      Volume.create({ ...config, name: "data" }),
    ).rejects.toMatchObject({ code: "volume_in_use" })
    await expect(Volume.deleteById("data", config)).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockImplementation(async () => {
      throw new TypeError("connection interrupted")
    })
    await expect(Volume.create({ ...config, name: "data" })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("never deletes an existing sandbox on attach failure and rejects incomplete attestations", async () => {
    const calls: { url: string; method?: string }[] = []
    let response: unknown = { ...attachment, status: "mounting" }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method })
        if (url.endsWith("/sandboxes")) return json(sandbox)
        if (init.method === "GET") return json(volume)
        return json(response)
      }),
    )
    const guest = await Sandbox.create({ ...config, name: "example" })
    await expect(
      guest.attachVolume("data", { mountPath: "/mnt/data" }),
    ).rejects.toThrow(/did not confirm/)
    response = { ...attachment, read_only: true }
    await expect(
      guest.attachVolume("data", { mountPath: "/mnt/data" }),
    ).rejects.toThrow(/did not confirm/)
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0)
  })

  it.each(["data", volume.id])(
    "honors a short attach timeout while looking up volume %s",
    async (nameOrId) => {
      const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/sandboxes")) return json(sandbox)
        if (init.method !== "GET") return json(attachment)
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(json(volume)), 2_000)
          init.signal!.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              reject(init.signal!.reason)
            },
            { once: true },
          )
        })
      })
      vi.stubGlobal("fetch", fetcher)
      const guest = await Sandbox.create({ ...config, name: "example" })
      vi.useFakeTimers()
      let outcome: unknown = "pending"
      const pending = guest
        .attachVolume(nameOrId, { mountPath: "/mnt/data", timeoutMs: 1_000 })
        .then(
          (value) => {
            outcome = value
          },
          (error: unknown) => {
            outcome = error
          },
        )
      try {
        await vi.advanceTimersByTimeAsync(1_000)
        expect(outcome).toBeInstanceOf(TimeoutError)
        expect(fetcher).toHaveBeenCalledTimes(2)
      } finally {
        await vi.advanceTimersByTimeAsync(1_000)
        await pending
      }
    },
  )

  it("uses a longer bounded mount timeout and respects cancellation", async () => {
    const fetcher = vi.fn(async () => json(volume))
    vi.stubGlobal("fetch", fetcher)
    const handle = await Volume.connect("data", config)
    vi.useFakeTimers()
    fetcher.mockImplementation(
      async (_url?: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init!.signal!
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        }),
    )
    let settled = false
    const timed = handle
      .attach(sandbox.id, { mountPath: "/mnt/data" })
      .finally(() => {
        settled = true
      })
    const check = expect(timed).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(150_000)
    await check
    const controller = new AbortController()
    const cancelled = handle.attach(sandbox.id, {
      mountPath: "/mnt/data",
      signal: controller.signal,
    })
    const cancelledCheck = expect(cancelled).rejects.toThrow()
    controller.abort()
    await cancelledCheck
  })
})
