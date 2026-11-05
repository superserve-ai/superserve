import { AsyncLocalStorage } from "node:async_hooks"

// Next.js memoizes identical GET requests for the length of a server render,
// so a retry in the same render gets the first attempt's response back. Next
// skips that memoization for a request that brings its own abort signal.
const fresh = new AsyncLocalStorage<true>()

// Runs `read` so every Supabase request it makes goes to the network.
export function readFresh<T>(read: () => Promise<T>): Promise<T> {
  return fresh.run(true, read)
}

// The fetch for every server-side Supabase client. Outside `readFresh` it
// passes the request through unchanged.
export const supabaseFetch: typeof fetch = (input, init) =>
  fresh.getStore() && !init?.signal
    ? fetch(input, { ...init, signal: new AbortController().signal })
    : fetch(input, init)
