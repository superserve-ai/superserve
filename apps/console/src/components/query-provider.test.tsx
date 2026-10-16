import { QueryClient, useQueryClient } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
const { onAuthStateChange, unsubscribe, redirectToSignIn } = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  redirectToSignIn: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { onAuthStateChange } }),
}))
vi.mock("@/lib/auth/session-recovery", () => ({
  redirectToSignIn,
  recoverSession: vi.fn(),
}))
import { QueryProvider } from "./query-provider"

let client: QueryClient
function Probe() {
  client = useQueryClient()
  return null
}
beforeEach(() => {
  onAuthStateChange
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe } } })
  unsubscribe.mockReset()
  redirectToSignIn.mockReset()
})
it("clears private cached data and navigates on sign-out, then unsubscribes", () => {
  const { unmount } = render(
    <QueryProvider>
      <Probe />
    </QueryProvider>,
  )
  client.setQueryData(["private"], { value: "cached" })
  const callback = onAuthStateChange.mock.calls[0][0]
  callback("TOKEN_REFRESHED")
  expect(client.getQueryData(["private"])).toEqual({ value: "cached" })
  expect(redirectToSignIn).not.toHaveBeenCalled()
  callback("SIGNED_OUT")
  expect(client.getQueryData(["private"])).toBeUndefined()
  expect(redirectToSignIn).toHaveBeenCalledTimes(1)
  unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
