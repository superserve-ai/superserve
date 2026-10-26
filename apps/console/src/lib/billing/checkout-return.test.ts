import { describe, expect, it } from "vitest"

import { checkoutEntryPath, checkoutRecoveryPath } from "./checkout-return"
const team = "use:11111111-1111-4111-8111-111111111111"
describe("retained direct checkout callbacks", () => {
  it.each(["success", "cancel"])(
    "preserves %s routing and purchase identity",
    (status) => {
      const starter = `/plan-usage/buy-credit/?purchase=${status}&team=${team}&purchase_id=22222222-2222-4222-8222-222222222222`
      const pro = `/billing/pro/?billing=${status}&team=${team}&return=%2Fsandboxes%2F%3Fview%3Dall`
      expect(checkoutRecoveryPath(starter)).toBe(starter)
      expect(checkoutRecoveryPath(pro)).toBe(pro)
    },
  )
  it.each([
    `//evil.test/billing/pro/?billing=success&team=${team}`,
    `/billing/pro/?billing=success&team=${team}&return=%2F%2Fevil.test`,
    `/billing/pro/?billing=success&team=${team}&return=%2F%5Cevil.test`,
    `/billing/pro/?billing=success&team=${team}&team=${team}`,
    `/billing/pro/?billing=success&team=use:invalid`,
    `/billing/pro/?billing=success`,
    `/billing/pro/?billing=success&team=${team}&operation=other`,
    `/plan-usage/buy-credit/?purchase=success&team=${team}&purchase_id=bad`,
    `/billing/pro/?billing=success&team=${team}#other`,
  ])("rejects unsafe, ambiguous or incomplete callback %s", (path) => {
    expect(checkoutRecoveryPath(path)).toBeNull()
  })
})

describe("fresh team-pinned entry remains separate from payment results", () => {
  it.each([
    `/billing/pro/?team=${team}&return=%2Fsandboxes%2F%3Fview%3Dall`,
    `/plan-usage/buy-credit/?team=${team}&amount=500`,
  ])(
    "retains validated fresh entry %s without treating it as a callback",
    (path) => {
      expect(checkoutEntryPath(path)).toBe(path)
      expect(checkoutRecoveryPath(path)).toBeNull()
    },
  )
  it.each([
    `/billing/pro/?team=${team}&billing=`,
    `/billing/pro/?team=${team}&billing=invalid`,
    `/billing/pro/?team=${team}&team=${team}`,
    `/billing/pro/?team=${team}&return=%2F%2Fevil.test`,
    `/billing/pro/?team=${team}&approved=true`,
    `/plan-usage/buy-credit/?team=${team}&purchase_id=22222222-2222-4222-8222-222222222222`,
    `/plan-usage/buy-credit/?team=${team}&purchase=`,
    `/plan-usage/buy-credit/?team=${team}&amount=500&amount=1000`,
  ])("does not reclassify malformed result or conflicting entry %s", (path) => {
    expect(checkoutEntryPath(path)).toBeNull()
  })
})
