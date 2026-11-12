import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const getUser = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { getUser } }),
}))

import { useUser } from "./use-user"

describe("useUser", () => {
  it("shares one lookup between components mounting together", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null })
    const first = renderHook(() => useUser())
    const second = renderHook(() => useUser())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(second.result.current.user).toEqual({ id: "user-1" })

    renderHook(() => useUser())
    await waitFor(() => expect(getUser).toHaveBeenCalledTimes(2))
  })
})
