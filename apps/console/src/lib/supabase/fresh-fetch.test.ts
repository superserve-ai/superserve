import { AsyncLocalStorage } from "node:async_hooks"

import { afterEach, expect, it, vi } from "vitest"

const network = vi.fn(async () => new Response("{}"))
vi.stubGlobal("fetch", network)

// Next puts AsyncLocalStorage on globalThis in every server runtime; the
// module reads it once, when it loads.
async function load(storage: typeof AsyncLocalStorage | undefined) {
  vi.resetModules()
  Object.assign(globalThis, { AsyncLocalStorage: storage })
  return import("./fresh-fetch")
}

afterEach(() => {
  network.mockClear()
  Object.assign(globalThis, { AsyncLocalStorage: undefined })
})

it("passes requests through unchanged outside a fresh read", async () => {
  const { supabaseFetch } = await load(AsyncLocalStorage)
  const init = { method: "GET", headers: { apikey: "key" } }
  await supabaseFetch("https://db.test/rest/v1/team", init)
  expect(network).toHaveBeenCalledWith("https://db.test/rest/v1/team", init)
})

it("gives every request in a fresh read its own signal", async () => {
  const { readFresh, supabaseFetch } = await load(AsyncLocalStorage)
  await readFresh(async () => {
    await supabaseFetch("https://db.test/auth/v1/user", { method: "GET" })
    await Promise.resolve()
    await supabaseFetch("https://db.test/auth/v1/user", { method: "GET" })
  })
  await supabaseFetch("https://db.test/auth/v1/user", { method: "GET" })
  const signals = network.mock.calls.map(
    (call) => (call as unknown as [string, RequestInit])[1].signal,
  )
  expect(signals).toHaveLength(3)
  expect(signals[0]).toBeInstanceOf(AbortSignal)
  expect(signals[1]).toBeInstanceOf(AbortSignal)
  expect(signals[0]).not.toBe(signals[1])
  expect(signals[2]).toBeUndefined()
})

it("keeps a caller's own signal", async () => {
  const { readFresh, supabaseFetch } = await load(AsyncLocalStorage)
  const signal = new AbortController().signal
  await readFresh(() => supabaseFetch("https://db.test/x", { signal }))
  expect(network).toHaveBeenCalledWith("https://db.test/x", { signal })
})

it("runs the read unchanged where AsyncLocalStorage isn't available", async () => {
  const { readFresh, supabaseFetch } = await load(undefined)
  const init = { method: "GET" }
  expect(
    await readFresh(async () => {
      await supabaseFetch("https://db.test/x", init)
      return "read"
    }),
  ).toBe("read")
  expect(network).toHaveBeenCalledWith("https://db.test/x", init)
})
