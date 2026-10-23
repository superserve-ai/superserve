import { afterEach, describe, expect, it, vi } from "vitest"

import { PLAN_UNAVAILABLE_MESSAGE, startProCheckout } from "./plan-checkout"

describe("startProCheckout", () => {
  afterEach(() => vi.restoreAllMocks())

  it("reports a plan billing does not sell yet instead of a payment failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "invalid_offer", message: "plan is not available" },
        }),
        { status: 400 },
      ),
    )

    await expect(
      startProCheckout(
        "use:team",
        "starter_monthly",
        "https://console.example.com/onboarding/plan/",
      ),
    ).rejects.toThrow(PLAN_UNAVAILABLE_MESSAGE)
  })
})
