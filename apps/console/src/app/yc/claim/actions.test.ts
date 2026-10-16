// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  deleteCookie: vi.fn(),
  ReviewError: class extends Error {},
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.deleteCookie }),
}))
vi.mock("@/lib/yc-claims", () => ({
  ycAccount: async () => ({ id: "user" }),
  ycProof: async () => ({ id: "claim", token: "proof" }),
  ycTeams: async () => [{ teamId: "team", region: "use" }],
  ycRequest: mocks.request,
  YC_COOKIE: "yc_claim_confirmation",
  YCManualReviewError: mocks.ReviewError,
}))
import { bindYCClaim } from "./actions"
beforeEach(() => vi.resetAllMocks())
it("preserves manual review and retains the confirmation proof", async () => {
  mocks.request.mockRejectedValue(new mocks.ReviewError("requires review"))
  const form = new FormData()
  form.set("team", "use:team")
  await expect(bindYCClaim(form)).rejects.toThrow(
    "redirect:/yc/claim?result=review",
  )
  expect(mocks.deleteCookie).not.toHaveBeenCalled()
})
it("offers retry for transient service failure", async () => {
  mocks.request.mockRejectedValue(new Error("unavailable"))
  const form = new FormData()
  form.set("team", "use:team")
  await expect(bindYCClaim(form)).rejects.toThrow(
    "redirect:/yc/claim?result=retry",
  )
})
