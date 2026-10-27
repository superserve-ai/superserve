import { act, render } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  retainSignOutReturnPath,
  SessionExpiryRedirect,
} from "./session-expiry-redirect"
const state = vi.hoisted(() => ({
  assign: vi.fn(),
  event: undefined as undefined | ((event: string) => void),
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string) => void) => {
        state.event = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  }),
}))
const first =
  "/billing/pro/?team=use:11111111-1111-4111-8111-111111111111&billing=success"
const second =
  "/plan-usage/buy-credit/?team=use:22222222-2222-4222-8222-222222222222&purchase=success"
beforeEach(() => {
  state.assign.mockReset()
  vi.stubGlobal("location", {
    assign: state.assign,
    pathname: "/sandboxes/",
    search: "",
  })
})
it("consumes the latest explicit destination once without one cleanup erasing another owner", async () => {
  const releaseFirst = retainSignOutReturnPath(first)
  const releaseSecond = retainSignOutReturnPath(second)
  releaseFirst()
  render(<SessionExpiryRedirect />)
  await act(async () => state.event?.("SIGNED_OUT"))
  expect(state.assign).toHaveBeenLastCalledWith(
    `/auth/signin?next=${encodeURIComponent(second)}`,
  )
  await act(async () => state.event?.("SIGNED_OUT"))
  expect(state.assign).toHaveBeenLastCalledWith(
    `/auth/signin?next=${encodeURIComponent("/sandboxes/")}`,
  )
  releaseSecond()
})
it("rejects unsafe or malformed explicit navigation without changing normal expiry behavior", async () => {
  expect(() => retainSignOutReturnPath("//external.test")).toThrow()
  expect(() =>
    retainSignOutReturnPath("/billing/pro/?billing=invalid"),
  ).toThrow()
  render(<SessionExpiryRedirect />)
  await act(async () => state.event?.("SIGNED_OUT"))
  expect(state.assign).toHaveBeenCalledWith(
    `/auth/signin?next=${encodeURIComponent("/sandboxes/")}`,
  )
})
