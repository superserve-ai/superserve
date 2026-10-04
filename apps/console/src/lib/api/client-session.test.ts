import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const { getSession, getUser } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getSession, getUser } }),
}))
import { apiClient, apiClientList } from "./client"
const unauthorized = () =>
  new Response(
    JSON.stringify({
      error: { code: "unauthorized", message: "Not authenticated" },
    }),
    { status: 401 },
  )

describe("API session recovery", () => {
  const fetch = vi.fn()
  const replace = vi.fn()
  beforeEach(() => {
    fetch.mockReset()
    replace.mockReset()
    getSession
      .mockReset()
      .mockResolvedValue({ data: { session: {} }, error: null })
    getUser
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "user" } }, error: null })
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("window", {
      location: {
        pathname: "/sandboxes/",
        search: "?status=paused",
        hash: "",
        replace,
      },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it("recovers a failed paginated read transparently", async () => {
    fetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(
        new Response('[{"id":"one"}]', { headers: { "X-Total-Count": "7" } }),
      )
    expect(await apiClientList("/sandboxes")).toEqual({
      items: [{ id: "one" }],
      total: 7,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(replace).not.toHaveBeenCalled()
  })
  it("redirects an ended session with the original destination", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    fetch.mockResolvedValueOnce(unauthorized())
    await expect(apiClient("/sandboxes")).rejects.toMatchObject({ status: 401 })
    expect(replace).toHaveBeenCalledWith(
      "/auth/signin?next=%2Fsandboxes%2F%3Fstatus%3Dpaused",
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("does not loop or redirect on an upstream 401 with valid console auth", async () => {
    fetch.mockImplementation(async () => unauthorized())
    await expect(apiClient("/sandboxes")).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
  it.each(["POST", "PATCH", "PUT", "DELETE"])(
    "never replays a %s even when recovery succeeds",
    async (method) => {
      fetch.mockResolvedValueOnce(unauthorized())
      await expect(
        apiClient("/sandboxes", { method, body: "{}" }),
      ).rejects.toMatchObject({ status: 401 })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(replace).not.toHaveBeenCalled()
    },
  )
  it("does not redirect or replay on transient auth failure", async () => {
    getUser.mockRejectedValue(new TypeError("Network unavailable"))
    fetch.mockResolvedValueOnce(unauthorized())
    await expect(apiClient("/sandboxes")).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
  it.each([403, 429, 500, 503])(
    "does not run auth recovery for API status %s",
    async (status) => {
      fetch.mockResolvedValueOnce(new Response("{}", { status }))
      await expect(apiClient("/sandboxes")).rejects.toMatchObject({ status })
      expect(getSession).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
    },
  )
  it("does not retry or navigate after the request deadline", async () => {
    vi.useFakeTimers()
    let finish!: (value: unknown) => void
    getSession.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    fetch.mockResolvedValueOnce(unauthorized())
    const pending = apiClient("/sandboxes", {}, 100)
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await vi.advanceTimersByTimeAsync(101)
    await assertion
    finish({ data: { session: null }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
})
