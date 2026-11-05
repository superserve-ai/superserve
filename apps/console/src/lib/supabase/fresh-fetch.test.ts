import { afterEach, expect, it, vi } from "vitest"

import { readFresh, supabaseFetch } from "./fresh-fetch"

const network = vi.fn(async () => new Response("{}"))
vi.stubGlobal("fetch", network)

afterEach(() => network.mockClear())

it("passes requests through unchanged outside a fresh read", async () => {
  const init = { method: "GET", headers: { apikey: "key" } }
  await supabaseFetch("https://db.test/rest/v1/team", init)
  expect(network).toHaveBeenCalledWith("https://db.test/rest/v1/team", init)
})

it("gives every request in a fresh read its own signal", async () => {
  await readFresh(async () => {
    await supabaseFetch("https://db.test/auth/v1/user", { method: "GET" })
    await Promise.resolve()
    await supabaseFetch("https://db.test/auth/v1/user", { method: "GET" })
  })
  const signals = network.mock.calls.map(
    (call) => (call as unknown as [string, RequestInit])[1].signal,
  )
  expect(signals).toHaveLength(2)
  expect(signals[0]).toBeInstanceOf(AbortSignal)
  expect(signals[1]).toBeInstanceOf(AbortSignal)
  expect(signals[0]).not.toBe(signals[1])
})

it("keeps a caller's own signal", async () => {
  const signal = new AbortController().signal
  await readFresh(() => supabaseFetch("https://db.test/x", { signal }))
  expect(network).toHaveBeenCalledWith("https://db.test/x", { signal })
})
