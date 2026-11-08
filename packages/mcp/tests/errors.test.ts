import {
  AuthenticationError,
  BillingError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "@superserve/sdk"
import { describe, expect, it } from "vitest"

import { formatSdkError } from "../src/lib/errors.js"

describe("formatSdkError", () => {
  it("auth errors point at the API key", () => {
    expect(formatSdkError(new AuthenticationError())).toMatch(
      /SUPERSERVE_API_KEY/,
    )
  })
  it("not-found nudges toward sandbox_list / sandbox_create", () => {
    const msg = formatSdkError(new NotFoundError("Sandbox abc not found"))
    expect(msg).toMatch(/sandbox_list/)
  })
  it("validation errors echo the reason", () => {
    expect(
      formatSdkError(new ValidationError("Path must be absolute")),
    ).toMatch(/Path must be absolute/)
  })
  it("conflict suggests re-checking", () => {
    expect(formatSdkError(new ConflictError("already deleted"))).toMatch(
      /sandbox_info/,
    )
  })
  it("quota rate-limit is actionable", () => {
    const msg = formatSdkError(
      new RateLimitError("Rate limit exceeded", "too_many_sandboxes"),
    )
    expect(msg).toMatch(/quota/i)
  })
  it("trial_exhausted tells the agent to ask the user to choose a plan", () => {
    const msg = formatSdkError(
      new BillingError(
        "used up",
        "trial_exhausted",
        "https://console.example.com/auth/choose-plan",
      ),
    )
    expect(msg).toMatch(/free trial credit is used up/)
    expect(msg).toContain("https://console.example.com/auth/choose-plan")
    expect(msg).toMatch(/Do not retry/)
    expect(msg).toMatch(
      /does not delete sandboxes, but a sandbox set to auto-delete/,
    )
    expect(msg).not.toMatch(/Nothing is deleted/)
  })
  it("trial_unavailable does not say the trial was used up", () => {
    const msg = formatSdkError(
      new BillingError(
        "n/a",
        "trial_unavailable",
        "https://console.example.com/auth/choose-plan",
      ),
    )
    expect(msg).toMatch(/not available for this account/)
    expect(msg).not.toMatch(/used up/)
    expect(msg).toContain("https://console.example.com/auth/choose-plan")
  })
  it("trial_check_unavailable is neither used up nor a denial", () => {
    const msg = formatSdkError(
      new BillingError(
        "n/a",
        "trial_check_unavailable",
        "https://console.example.com/plan-usage",
      ),
    )
    expect(msg).toMatch(/could not be confirmed/)
    expect(msg).not.toMatch(/used up|not available for this account/)
    expect(msg).toMatch(/Do not retry in a loop/)
    expect(msg).toContain("https://console.example.com/plan-usage")
    expect(msg).toMatch(
      /does not delete sandboxes, but a sandbox set to auto-delete/,
    )
    expect(msg).not.toMatch(/Nothing is deleted/)
  })
  it("generic billing_ineligible claims nothing specific", () => {
    const msg = formatSdkError(
      new BillingError("unavailable", "billing_ineligible"),
    )
    expect(msg).toMatch(/^unavailable\./)
    expect(msg).not.toMatch(/trial|deleted|card/i)
  })
  it("billing_ineligible keeps the server message without an action URL", () => {
    const msg = formatSdkError(
      new BillingError("Billing is not active", "billing_ineligible"),
    )
    expect(msg).toBe(
      "Billing is not active. Do not retry. Ask the user to check their billing in the Superserve console.",
    )
  })
  it("unknown billing codes keep the server message and action URL", () => {
    const msg = formatSdkError(
      new BillingError(
        "Billing needs review",
        "unknown_billing_code",
        "https://console.example.com/plan-usage",
      ),
    )
    expect(msg).toBe(
      "Billing needs review. Do not retry. Ask the user to check their billing at https://console.example.com/plan-usage.",
    )
  })
  it.each([".", "!", "?"])(
    "billing messages ending with %s do not add another period",
    (punctuation) => {
      const msg = formatSdkError(
        new BillingError(
          `Billing is not active${punctuation}`,
          "billing_ineligible",
        ),
      )
      expect(msg).toBe(
        `Billing is not active${punctuation} Do not retry. Ask the user to check their billing in the Superserve console.`,
      )
      expect(msg).not.toContain("..")
    },
  )
  it.each(["", " \t\n "])(
    "empty billing message %j uses generic fallback text",
    (message) => {
      const msg = formatSdkError(
        new BillingError(message, "billing_ineligible"),
      )
      expect(msg).toBe(
        "Billing does not allow this request. Do not retry. Ask the user to check their billing in the Superserve console.",
      )
    },
  )
  it("plan-limit billing errors keep the server message", () => {
    expect(
      formatSdkError(
        new BillingError("Plan allows 4 vCPU", "sandbox_exceeds_plan_limits"),
      ),
    ).toBe("Plan allows 4 vCPU")
  })
  it("server errors flag transience", () => {
    expect(formatSdkError(new ServerError())).toMatch(/retry/i)
  })
  it("timeout passes through its message", () => {
    expect(
      formatSdkError(new TimeoutError("Command timed out after 1000ms")),
    ).toMatch(/timed out/)
  })
  it("unknown values do not throw", () => {
    expect(formatSdkError("weird")).toBe("Unexpected error.")
  })
})
