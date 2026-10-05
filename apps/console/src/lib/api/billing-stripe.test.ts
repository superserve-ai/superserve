import { beforeEach, expect, it, vi } from "vitest"
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  apiClient: vi.fn(),
}))
import { createStripeCheckoutSession } from "./billing-stripe"
import { ApiError, apiClient } from "./client"
const params = {
  successUrl: "https://console.test/success",
  cancelUrl: "https://console.test/cancel",
  intentScope: "actor:use:team",
}
const key = `superserve:checkout:${params.intentScope}`
beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(apiClient).mockReset()
})
it("retains the signed receipt before dispatch and replays it after uncertain response/refresh", async () => {
  vi.mocked(apiClient)
    .mockResolvedValueOnce({ receipt: "signed-no-credit" })
    .mockImplementationOnce(async () => {
      expect(JSON.parse(sessionStorage.getItem(key)!).receipt).toBe(
        "signed-no-credit",
      )
      throw new Error("response lost")
    })
  await expect(createStripeCheckoutSession(params)).rejects.toThrow(
    "response lost",
  )
  const original = JSON.parse(sessionStorage.getItem(key)!)
  vi.mocked(apiClient).mockResolvedValueOnce({ id: "same", url: "stripe" })
  await createStripeCheckoutSession({ ...params, successUrl: "changed" })
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(original)
  expect(vi.mocked(apiClient).mock.calls[2][1]?.body).toBe(
    JSON.stringify({ receipt: "signed-no-credit" }),
  )
  expect(apiClient).toHaveBeenCalledTimes(3)
})
it("does not dispatch when receipt storage fails", async () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage unavailable")
    },
  })
  try {
    await expect(createStripeCheckoutSession(params)).rejects.toThrow(
      "storage unavailable",
    )
    expect(apiClient).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
it("preserves an old receipt and waits for the instructed next click before requesting a new intent", async () => {
  sessionStorage.setItem(
    key,
    JSON.stringify({ operationId: "original", receipt: "original-receipt" }),
  )
  vi.mocked(apiClient).mockRejectedValueOnce(
    new ApiError(409, "conflict", "in progress or closed"),
  )
  await expect(createStripeCheckoutSession(params)).rejects.toThrow(
    "Click Set Up Billing again",
  )
  expect(apiClient).toHaveBeenCalledTimes(1)
  vi.mocked(apiClient)
    .mockResolvedValueOnce({ receipt: "new-receipt" })
    .mockResolvedValueOnce({ url: "stripe" })
  await createStripeCheckoutSession(params)
  expect(
    JSON.parse(sessionStorage.getItem(`${key}:previous:original`)!).receipt,
  ).toBe("original-receipt")
  expect(
    JSON.parse(vi.mocked(apiClient).mock.calls[1][1]!.body as string)
      .operation_id,
  ).not.toBe("original")
})
