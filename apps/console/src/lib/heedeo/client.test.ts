import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { decodeHeedeoCapture } from "./shared"

type ClientModule = typeof import("./client")

async function load(key: string | undefined): Promise<ClientModule> {
  vi.resetModules()
  if (key === undefined) vi.stubEnv("NEXT_PUBLIC_HEEDEO_KEY", "")
  else vi.stubEnv("NEXT_PUBLIC_HEEDEO_KEY", key)
  return import("./client")
}

let writes: string[] = []
let scripts: HTMLScriptElement[] = []

function captured() {
  const last = writes.findLast((write) =>
    write.startsWith("superserve-heedeo-signup="),
  )
  const value = last?.split(";")[0]?.slice("superserve-heedeo-signup=".length)
  return decodeHeedeoCapture(value)
}

beforeEach(() => {
  writes = []
  scripts = []
  // Keep the script element out of the page: the test DOM would try to fetch it.
  const append = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node instanceof HTMLScriptElement) scripts.push(node)
    else append(node)
    return node
  })
  vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
    writes.push(value)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete window.heedeo
})

describe("Heedeo browser capture", () => {
  it("does nothing without a publishable key", async () => {
    const client = await load(undefined)
    expect(client.HEEDEO_SCRIPT_SRC).toBeUndefined()
    await client.captureHeedeoSignup()
    expect(writes).toEqual([])
  })

  it("serves the script from the console origin", async () => {
    const client = await load("pk_live_123")
    expect(client.HEEDEO_SCRIPT_SRC).toBe("/api/dv/i.js?key=pk_live_123")
  })

  it("loads the script once, when first asked or at the capture", async () => {
    const client = await load("pk_live_123")
    expect(scripts).toHaveLength(0)
    client.loadHeedeoScript()
    client.heedeoPreloadProps.onFocus()
    window.heedeo = {
      identify: vi.fn(async () => ({
        token: "ct1.t",
        visitor_id: "v",
        confidence: 1,
      })),
    }
    await client.captureHeedeoSignup()
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.getAttribute("src")).toBe("/api/dv/i.js?key=pk_live_123")
  })

  it("reports a script that cannot load as failed", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    const done = client.captureHeedeoSignup(5000)
    scripts[0]!.dispatchEvent(new Event("error"))
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(captured()).toMatchObject({ status: "script_failed" })
  })

  it("writes the token for the server, after clearing an earlier one", async () => {
    const client = await load("pk_live_123")
    const identify = vi.fn(async () => ({
      token: "ct1.tok",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await client.captureHeedeoSignup()
    expect(identify).toHaveBeenCalledWith()
    expect(writes[0]).toContain("Max-Age=0")
    expect(writes.at(-1)).toContain("Path=/auth")
    expect(writes.at(-1)).toContain("Max-Age=300")
    expect(writes.at(-1)).toContain("SameSite=Lax")
    expect(captured()).toMatchObject({ status: "ok", token: "ct1.tok" })
    expect(writes).toContain("_idt=; Path=/; Max-Age=0")
  })

  it("records an identify error without failing", async () => {
    const client = await load("pk_live_123")
    window.heedeo = {
      identify: vi.fn(async () => {
        throw new Error("blocked")
      }),
    }
    await expect(client.captureHeedeoSignup()).resolves.toBeUndefined()
    expect(captured()).toMatchObject({ status: "identify_error", token: null })
  })

  it("records an answer with no usable token", async () => {
    const client = await load("pk_live_123")
    window.heedeo = {
      identify: vi.fn(async () => ({
        token: "",
        visitor_id: "v",
        confidence: 1,
      })),
    }
    await client.captureHeedeoSignup()
    expect(captured()).toMatchObject({ status: "invalid_response" })
  })

  it("stops waiting for identify at the budget", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    window.heedeo = { identify: () => new Promise(() => {}) }
    const done = client.captureHeedeoSignup(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await done
    expect(captured()).toMatchObject({ status: "identify_timeout" })
  })

  it("stops waiting for a script that never loads", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    const done = client.captureHeedeoSignup(500)
    await vi.advanceTimersByTimeAsync(600)
    await done
    expect(captured()).toMatchObject({ status: "script_timeout" })
  })

  it("does not wait for a script that failed to load", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    client.markHeedeoScriptFailed()
    const done = client.captureHeedeoSignup(5000)
    await vi.advanceTimersByTimeAsync(0)
    await done
    expect(captured()).toMatchObject({ status: "script_failed" })
  })

  it("lets only the newest capture write its result", async () => {
    const client = await load("pk_live_123")
    let resolveFirst: (value: {
      token: string
      visitor_id: string
      confidence: number
    }) => void = () => {}
    const identify = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(async () => ({
        token: "ct1.second",
        visitor_id: "v",
        confidence: 1,
      }))
    window.heedeo = { identify }
    const first = client.captureHeedeoSignup()
    await client.captureHeedeoSignup()
    resolveFirst({ token: "ct1.first", visitor_id: "v", confidence: 1 })
    await first
    expect(captured()).toMatchObject({ token: "ct1.second" })
  })

  it("stops the email wait at the tail and drops the late result", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    let resolveIdentify: (value: {
      token: string
      visitor_id: string
      confidence: number
    }) => void = () => {}
    window.heedeo = {
      identify: () =>
        new Promise((resolve) => {
          resolveIdentify = resolve
        }),
    }
    const capture = client.captureHeedeoSignup()
    const settled = client.settleHeedeoSignup(capture, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await settled
    expect(captured()).toMatchObject({
      status: "identify_timeout",
      token: null,
    })
    resolveIdentify({ token: "ct1.late", visitor_id: "v", confidence: 1 })
    await capture
    expect(captured()).toMatchObject({
      status: "identify_timeout",
      token: null,
    })
  })

  it("keeps a capture that finishes within the tail", async () => {
    const client = await load("pk_live_123")
    window.heedeo = {
      identify: async () => ({
        token: "ct1.ok",
        visitor_id: "v",
        confidence: 1,
      }),
    }
    await client.settleHeedeoSignup(client.captureHeedeoSignup(), 1000)
    expect(captured()).toMatchObject({ status: "ok", token: "ct1.ok" })
  })

  it("does not identify for a capture the email wait gave up on", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    const capture = client.captureHeedeoSignup()
    const settled = client.settleHeedeoSignup(capture, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await settled
    const identify = vi.fn(async () => ({
      token: "ct1.late",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await vi.advanceTimersByTimeAsync(3000)
    await capture
    expect(identify).not.toHaveBeenCalled()
    expect(captured()).toMatchObject({ status: "script_timeout", token: null })
  })

  it("does not identify for a capture whose attempt was aborted", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    const attempt = new AbortController()
    const capture = client.captureHeedeoSignup(2500, attempt.signal)
    await vi.advanceTimersByTimeAsync(100)
    attempt.abort()
    const identify = vi.fn(async () => ({
      token: "ct1.late",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await vi.advanceTimersByTimeAsync(3000)
    await capture
    expect(identify).not.toHaveBeenCalled()
    expect(captured()).toBeNull()
  })

  it("writes no cookie for an identify that answers after its attempt was aborted", async () => {
    const client = await load("pk_live_123")
    let answer!: (value: {
      token: string
      visitor_id: string
      confidence: number
    }) => void
    window.heedeo = {
      identify: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    }
    const attempt = new AbortController()
    const capture = client.captureHeedeoSignup(2500, attempt.signal)
    await vi.waitFor(() => expect(answer).toBeDefined())
    attempt.abort()
    answer({ token: "ct1.late", visitor_id: "v", confidence: 1 })
    await capture
    expect(captured()).toBeNull()
  })

  it("keeps a newer capture when an older attempt is aborted", async () => {
    vi.useFakeTimers()
    const client = await load("pk_live_123")
    const older = new AbortController()
    const first = client.captureHeedeoSignup(2500, older.signal)
    const second = client.captureHeedeoSignup(
      2500,
      new AbortController().signal,
    )
    older.abort()
    const identify = vi.fn(async () => ({
      token: "ct1.newer",
      visitor_id: "v",
      confidence: 1,
    }))
    window.heedeo = { identify }
    await vi.advanceTimersByTimeAsync(200)
    await Promise.all([first, second])
    expect(identify).toHaveBeenCalledTimes(1)
    expect(captured()).toMatchObject({ status: "ok", token: "ct1.newer" })
  })
})
