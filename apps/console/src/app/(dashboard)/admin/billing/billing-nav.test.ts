import { describe, expect, it } from "vitest"

import { isActiveBillingTab } from "./billing-nav"

describe("isActiveBillingTab", () => {
  it("matches the overview only on its own path", () => {
    expect(isActiveBillingTab("/admin/billing", "/admin/billing")).toBe(true)
    expect(isActiveBillingTab("/admin/billing/", "/admin/billing")).toBe(true)
    expect(isActiveBillingTab("/admin/billing/teams", "/admin/billing")).toBe(
      false,
    )
  })

  it("matches nested pages of a tab", () => {
    expect(
      isActiveBillingTab("/admin/billing/teams/abc", "/admin/billing/teams"),
    ).toBe(true)
    expect(
      isActiveBillingTab("/admin/billing/teams/", "/admin/billing/teams"),
    ).toBe(true)
    expect(
      isActiveBillingTab("/admin/billing/teamsx", "/admin/billing/teams"),
    ).toBe(false)
  })
})
