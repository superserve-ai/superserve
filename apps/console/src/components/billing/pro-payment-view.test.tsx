import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { planCard, type PublicBillingPlans } from "@/lib/billing/plans"
import { safeReturnPath } from "@/lib/billing/return-path"

import { ProPaymentView, proPaymentStep } from "./pro-payment-view"

const v2: PublicBillingPlans = {
  pricing_version: "v2",
  cards: [
    {
      family: "pro",
      version: 1,
      kind: "subscription",
      name: "Pro",
      price_label: "$250/month",
      tagline: "",
      features: [],
      display_only: false,
      monthly: {
        offer_key: "pro_monthly",
        price_cents: 25000,
        monthly_equivalent_cents: 25000,
        available: true,
      },
      annual: null,
      credit_summary: "$250 every month",
      monthly_credit_cents: 25000,
      allowance: null,
      matching: null,
      limits: {
        max_concurrent: 1000,
        max_vcpu: 8,
        max_memory_mib: 32768,
        max_disk_mib: 102400,
        max_templates: null,
      },
    },
  ],
}

describe("Pro payment step", () => {
  it("offers nothing until pricing v2 is on", () => {
    for (const plans of [
      undefined,
      { ...v2, pricing_version: "legacy" as const },
    ])
      expect(
        proPaymentStep({
          loading: false,
          plans,
          conflict: false,
          confirming: false,
        }),
      ).toBe("unavailable")
  })

  it("offers Pro under pricing v2 and tracks payment state", () => {
    const state = {
      loading: false,
      plans: v2,
      conflict: false,
      confirming: false,
    }
    expect(proPaymentStep(state)).toBe("offer")
    expect(proPaymentStep({ ...state, confirming: true })).toBe("confirming")
    expect(proPaymentStep({ ...state, conflict: true })).toBe("conflict")
    expect(proPaymentStep({ ...state, loading: true })).toBe("loading")
  })

  it("keeps pending payment recovery available without a live offer", () => {
    for (const plans of [
      undefined,
      { ...v2, pricing_version: "legacy" as const },
      { ...v2, cards: [] },
    ]) {
      const step = proPaymentStep({
        loading: false,
        plans,
        conflict: false,
        confirming: true,
      })
      expect(step).toBe("confirming")
    }
    const check = vi.fn()
    render(
      <ProPaymentView
        step="confirming"
        busy={false}
        canceled={false}
        onContinue={vi.fn()}
        onCheckPayment={check}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    expect(check).toHaveBeenCalledOnce()
  })

  it("does not interpret another team's payment state as the checkout result", () => {
    expect(
      proPaymentStep({
        loading: false,
        plans: v2,
        paidPlan: "Pro",
        confirming: true,
        conflict: false,
        teamMismatch: true,
      }),
    ).toBe("team_mismatch")
    render(
      <ProPaymentView
        step="team_mismatch"
        busy={false}
        canceled={false}
        onContinue={vi.fn()}
        onCheckPayment={vi.fn()}
      />,
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "team you used for checkout",
    )
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
  })

  it("sends a team already on a paid plan to Billing, even with pricing v2 off", () => {
    for (const plans of [v2, { ...v2, pricing_version: "legacy" as const }])
      expect(
        proPaymentStep({
          loading: false,
          plans,
          paidPlan: "Pro Monthly",
          conflict: false,
          confirming: false,
        }),
      ).toBe("subscribed")
    expect(
      proPaymentStep({
        loading: false,
        plans: v2,
        paidPlan: "Pro Monthly",
        conflict: false,
        confirming: true,
      }),
    ).toBe("confirming")
  })
})

describe("Pro payment view", () => {
  it("describes prorated credit without promising that it equals the cash fee", () => {
    render(
      <ProPaymentView
        step="offer"
        pro={planCard(v2, "pro")}
        busy={false}
        canceled={false}
        onContinue={vi.fn()}
        onCheckPayment={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        /prorated non-expiring usage credit based on your selected plan/,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/same amount in non-expiring/)).toBeNull()
  })

  it("shows the catalog price and starts checkout", () => {
    const onContinue = vi.fn()
    const pro = planCard(v2, "pro")!
    render(
      <ProPaymentView
        step="offer"
        pro={pro}
        busy={false}
        canceled={false}
        onContinue={onContinue}
        onCheckPayment={vi.fn()}
      />,
    )
    expect(screen.getByText(pro.credit_summary)).toBeTruthy()
    expect(screen.getByText(/promotion code.*first invoice/i)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})

describe("Pro payment return path", () => {
  it("returns only to console paths", () => {
    expect(safeReturnPath("/billing/upgrade/")).toBe("/billing/upgrade/")
    for (const unsafe of [
      undefined,
      "",
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "billing",
      "/\n/example.com/",
      "/\t/example.com/",
      "/\r/example.com/",
      "/\u0000/example.com/",
      "/\u007f/example.com/",
    ])
      expect(safeReturnPath(unsafe)).toBe("/plan-usage/")
  })
})
