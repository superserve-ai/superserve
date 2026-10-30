import { describe, expect, it } from "vitest"

import {
  awaitingPlanRedirect,
  isPaymentActivating,
} from "./signup-checkout-paths"

const team = {
  userId: "u1",
  teamKey: "use:team-1",
  requestedOffer: "developer",
}

describe("awaitingPlanRedirect", () => {
  it.each(["trial_ended", undefined] as const)(
    "never sends a team whose paid checkout settles (entry %s) to the picker",
    (entryState) => {
      expect(
        awaitingPlanRedirect({ ...team, entryState, paymentSettling: true }),
      ).toBe("/onboarding/payment/?account=u1&team=use%3Ateam-1")
    },
  )

  it("sends a failed payment to the picker even with a checkout on record", () => {
    expect(
      awaitingPlanRedirect({
        ...team,
        entryState: "payment_failed",
        paymentSettling: true,
      }),
    ).toBe(
      "/auth/choose-plan/?reason=payment_failed&offer=developer&account=u1&team=use%3Ateam-1",
    )
  })

  it("keeps a settling team on its trial in the console", () => {
    expect(
      awaitingPlanRedirect({
        ...team,
        entryState: "trial",
        paymentSettling: true,
      }),
    ).toBeNull()
  })

  it("sends a used-up trial with nothing paid to the picker", () => {
    expect(awaitingPlanRedirect({ ...team, entryState: "trial_ended" })).toBe(
      "/auth/choose-plan/?reason=trial_ended&offer=developer&account=u1&team=use%3Ateam-1",
    )
  })
})

describe("isPaymentActivating", () => {
  it.each([
    [{ entry_state: "activating" }, true],
    [{ pro_checkout: { status: "activating" } }, true],
    [{ entry_state: "trial_ended" }, false],
    [{ pro_checkout: null }, false],
    [{}, false],
    [null, false],
  ])("reads %j as %s", (plan, activating) => {
    expect(isPaymentActivating(plan)).toBe(activating)
  })
})
