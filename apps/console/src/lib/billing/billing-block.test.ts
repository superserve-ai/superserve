import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/client"

import {
  BILLING_BLOCK_FALLBACK_PATH,
  billingBlockFromCode,
  billingBlockFromError,
  billingBlockMessage,
  billingBlockReason,
  billingEligible,
  billingStillBlocked,
  safeBillingActionHref,
} from "./billing-block"

const ORIGIN = "https://console.superserve.ai"

describe("safeBillingActionHref", () => {
  it.each([
    ["https://console.superserve.ai/plan-usage", "/billing-usage/"],
    ["https://console.superserve.ai/plan-usage/", "/billing-usage/"],
    [
      "https://console.superserve.ai/plan-usage/upgrade",
      "/billing-usage/upgrade/",
    ],
    ["/plan-usage", "/billing-usage/"],
    ["/billing-usage/?tab=plan#top", "/billing-usage/?tab=plan#top"],
    ["/auth/choose-plan/?reason=upgrade", "/auth/choose-plan/?reason=upgrade"],
    ["  /plan-usage  ", "/billing-usage/"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeBillingActionHref(input, ORIGIN)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    42,
    "",
    "   ",
    "https://evil.example.com/plan-usage",
    "http://console.superserve.ai/plan-usage",
    "https://console.superserve.ai.evil.example.com/plan-usage",
    "//evil.example.com/plan-usage",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "javascript:alert(1)",
    "data:text/html,hi",
    "plan-usage",
    "/plan-usage\n",
    "/api/billing/checkout",
    "https://console.superserve.ai/api/keys",
    "/x/..//evil.example.com/path",
    "https://console.superserve.ai//evil.example.com/path",
    "/%2e%2e//evil.example.com",
  ])("falls back for %o", (input) => {
    expect(safeBillingActionHref(input, ORIGIN)).toBe(
      BILLING_BLOCK_FALLBACK_PATH,
    )
  })

  it("accepts the server's link on any console origin it is opened on", () => {
    expect(
      safeBillingActionHref(
        "https://preview.example.com/plan-usage",
        "https://preview.example.com",
      ),
    ).toBe("/billing-usage/")
  })

  it("uses only relative links when the origin is unknown", () => {
    expect(safeBillingActionHref("/plan-usage", null)).toBe("/billing-usage/")
    expect(safeBillingActionHref(`${ORIGIN}/plan-usage`, null)).toBe(
      BILLING_BLOCK_FALLBACK_PATH,
    )
  })
})

describe("billingBlockMessage", () => {
  it("drops the trailing link the server appends", () => {
    const url = `${ORIGIN}/plan-usage`
    expect(
      billingBlockMessage(
        `Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes: ${url}`,
        url,
      ),
    ).toBe(
      "Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes.",
    )
  })

  it("drops a trailing link that differs from action_url", () => {
    expect(
      billingBlockMessage(
        "Add a card and choose a plan to use sandboxes: https://console.superserve.ai/plan-usage",
        undefined,
      ),
    ).toBe("Add a card and choose a plan to use sandboxes.")
  })

  it("keeps a message without a link", () => {
    expect(
      billingBlockMessage(
        "Sandbox usage is unavailable until billing is active",
        undefined,
      ),
    ).toBe("Sandbox usage is unavailable until billing is active.")
  })

  it("returns an empty string for an empty message", () => {
    expect(billingBlockMessage("", undefined)).toBe("")
  })
})

describe("billingBlockFromError", () => {
  it.each([
    ["trial_unavailable", "trial_denied", "Free trial not available"],
    ["trial_exhausted", "trial_used_up", "Free trial credit used up"],
    [
      "trial_check_unavailable",
      "system_unavailable",
      "Free trial not confirmed",
    ],
    ["billing_ineligible", "billing_inactive", "Billing action needed"],
  ])("keeps %s distinct as %s", (code, reason, title) => {
    const block = billingBlockFromError(
      new ApiError(402, code, "", `${ORIGIN}/plan-usage`),
      ORIGIN,
    )
    expect(block).toMatchObject({
      code,
      reason,
      title,
      href: "/billing-usage/",
    })
    expect(block?.description).not.toBe("")
  })

  it("gives no reason for codes a card or plan does not fix", () => {
    expect(billingBlockReason("free_allowance_exhausted")).toBeNull()
    expect(billingBlockReason("sandbox_exceeds_plan_limits")).toBeNull()
    expect(billingBlockReason("toString")).toBeNull()
  })

  it("keeps the three trial cases apart", () => {
    const reasons = [
      "trial_unavailable",
      "trial_exhausted",
      "trial_check_unavailable",
    ].map(billingBlockReason)
    expect(new Set(reasons).size).toBe(3)
  })

  it("uses the server message without its link", () => {
    const url = `${ORIGIN}/plan-usage`
    const block = billingBlockFromError(
      new ApiError(
        402,
        "trial_exhausted",
        `Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes: ${url}`,
        url,
      ),
      ORIGIN,
    )
    expect(block?.description).toBe(
      "Your free trial credit is used up. Add a card and choose a plan to keep using sandboxes.",
    )
    expect(block?.description).not.toContain("http")
  })

  it("falls back when action_url is missing or foreign", () => {
    expect(
      billingBlockFromError(new ApiError(402, "trial_exhausted", "x"), ORIGIN)
        ?.href,
    ).toBe(BILLING_BLOCK_FALLBACK_PATH)
    expect(
      billingBlockFromError(
        new ApiError(402, "trial_exhausted", "x", "https://evil.example.com/"),
        ORIGIN,
      )?.href,
    ).toBe(BILLING_BLOCK_FALLBACK_PATH)
  })

  it.each([
    new ApiError(403, "trial_exhausted", "x"),
    new ApiError(500, "internal", "x"),
    // Other 402s have a different next step than a card or a plan.
    new ApiError(402, "free_allowance_exhausted", "x"),
    new ApiError(402, "sandbox_exceeds_plan_limits", "x"),
    new ApiError(402, "payment_required", "x"),
    new Error("network"),
    "trial_exhausted",
    null,
  ])("is null for %o", (error) => {
    expect(billingBlockFromError(error, ORIGIN)).toBeNull()
  })
})

describe("billingBlockFromCode", () => {
  it("builds a block with the default copy and the fallback route", () => {
    expect(billingBlockFromCode("trial_exhausted")).toMatchObject({
      reason: "trial_used_up",
      href: BILLING_BLOCK_FALLBACK_PATH,
    })
  })
})

describe("billingStillBlocked", () => {
  it.each([
    [undefined, false],
    [{ trial_block: "trial_exhausted" }, true],
    [{ trial_block: "trial_check_unavailable" }, true],
    [{ trial_block: null, plan: { status: "trial_ended" } }, true],
    [{ trial_block: null, plan: { status: "payment_failed" } }, true],
    [{ trial_block: null, plan: { status: "plan_required" } }, true],
    [{ trial_block: null, plan: { status: "payment_method_required" } }, true],
    // A used-up legacy trial with no subscription in live billing.
    [{ trial_block: null, payment_setup_required: true }, true],
    [{ trial_block: null, plan: { status: "active" } }, false],
    [{ trial_block: null, plan: null }, false],
  ])("%o is %s", (summary, expected) => {
    expect(
      billingStillBlocked(summary as Parameters<typeof billingStillBlocked>[0]),
    ).toBe(expected)
  })
})

describe("billingEligible", () => {
  const contract = { status: "active", price_usd: 20 }
  it.each([
    [undefined, false],
    // No reason either way is not proof (generic blocks, plan optional).
    [{ trial_block: null }, false],
    [
      { trial_block: null, trial: { state: "exhausted", eligible: false } },
      false,
    ],
    // The legacy Free fallback has no price and proves nothing.
    [{ trial_block: null, plan: { status: "active", price_usd: null } }, false],
    [{ trial_block: null, trial: { state: "active", eligible: true } }, true],
    [{ trial_block: null, plan: contract }, true],
    [{ trial_block: null, plan: { ...contract, price_usd: 0 } }, true],
    [{ trial_block: "trial_exhausted", plan: contract }, false],
    [
      { trial_block: null, plan: { ...contract, status: "payment_failed" } },
      false,
    ],
    [{ plan: contract, payment_setup_required: true }, false],
  ])("%o is %s", (summary, expected) => {
    expect(
      billingEligible(summary as Parameters<typeof billingEligible>[0]),
    ).toBe(expected)
  })
})
