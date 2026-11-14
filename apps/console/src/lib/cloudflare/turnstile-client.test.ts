import { afterEach, beforeEach, expect, it, vi } from "vitest"

type Options = {
  callback: (token: string) => void
  "error-callback": () => void
}

let rendered: Options | undefined
const remove = vi.fn()
const render = vi.fn(
  (_element: HTMLElement, options: Record<string, unknown>) => {
    rendered = options as Options
    return "widget-1"
  },
)

async function load() {
  vi.stubEnv("NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY", "site-key")
  vi.resetModules()
  return import("./turnstile-client")
}

beforeEach(() => {
  vi.useFakeTimers()
  rendered = undefined
  remove.mockReset()
  render.mockClear()
  window.turnstile = { render, remove }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete window.turnstile
  document.body.replaceChildren()
})

it("gives no token without a site key", async () => {
  vi.stubEnv("NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY", "")
  vi.resetModules()
  const { getTurnstileToken } = await import("./turnstile-client")
  await expect(getTurnstileToken()).resolves.toBeUndefined()
  expect(render).not.toHaveBeenCalled()
})

it("resolves the token and removes the widget", async () => {
  const { getTurnstileToken } = await load()
  const result = getTurnstileToken()
  rendered!.callback("token-1")
  await expect(result).resolves.toBe("token-1")
  expect(remove).toHaveBeenCalledWith("widget-1")
  expect(document.body.children).toHaveLength(0)
})

it("gives up after its own time limit and removes the widget", async () => {
  const { getTurnstileToken } = await load()
  const result = getTurnstileToken()
  expect(document.body.children).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(3_000)
  await expect(result).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledWith("widget-1")
  expect(document.body.children).toHaveLength(0)
})

it("removes the widget when the caller aborts", async () => {
  const { getTurnstileToken } = await load()
  const abort = new AbortController()
  const result = getTurnstileToken(abort.signal)
  expect(document.body.children).toHaveLength(1)
  abort.abort()
  await expect(result).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledWith("widget-1")
  expect(document.body.children).toHaveLength(0)
})

it("adds no widget for a caller that aborted while the script loaded", async () => {
  delete window.turnstile
  const { getTurnstileToken } = await load()
  const abort = new AbortController()
  const result = getTurnstileToken(abort.signal)
  abort.abort()
  window.turnstile = { render, remove }
  await vi.advanceTimersByTimeAsync(200)
  await expect(result).resolves.toBeUndefined()
  expect(render).not.toHaveBeenCalled()
  expect(document.body.children).toHaveLength(0)
})
