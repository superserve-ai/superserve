import type { AsyncLocalStorage } from "node:async_hooks"

// Next.js memoizes identical GET requests for the length of a server render,
// so a retry in the same render gets the first attempt's response back. Next
// skips that memoization for a request that brings its own abort signal.
//
// Client components reach this module through the shared server client, so it
// must not import node:async_hooks. Next puts AsyncLocalStorage on globalThis
// in every server runtime; in the browser there is no scope and no change.
const Storage = (globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage })
  .AsyncLocalStorage
const fresh = Storage ? new Storage<true>() : undefined

// Runs `read` so every Supabase request it makes goes to the network.
export function readFresh<T>(read: () => Promise<T>): Promise<T> {
  return fresh ? fresh.run(true, read) : read()
}

// The fetch for every server-side Supabase client. Outside `readFresh` it
// passes the request through unchanged.
export const supabaseFetch: typeof fetch = (input, init) =>
  fresh?.getStore() && !init?.signal
    ? fetch(input, { ...init, signal: new AbortController().signal })
    : fetch(input, init)
