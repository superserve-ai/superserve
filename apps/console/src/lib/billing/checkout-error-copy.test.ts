import { describe, expect, it } from "vitest"
import { z } from "zod"

import { ApiError } from "@/lib/api/client"

import { checkoutErrorMessage } from "./checkout-error-copy"

const generic =
  "Something went wrong on our side. Try again in a few minutes. If it keeps happening, contact support@superserve.ai."
const connection =
  "We couldn't reach Superserve. Check your connection, then try again."

describe("checkoutErrorMessage", () => {
  it.each([
    "plan_team_changed",
    "signup_review_pending",
    "signup_blocked",
    "read_only_impersonation",
    "authentication_unavailable",
  ])("preserves only console proxy copy for %s", (code) => {
    expect(
      checkoutErrorMessage(new ApiError(403, code, "Please reload.")),
    ).toBe("Please reload.")
    expect(checkoutErrorMessage(new ApiError(403, code, ""))).toBe(generic)
  })

  it.each([
    [401, "unknown", "Your session expired. Sign in again to continue."],
    [400, "unauthorized", "Your session expired. Sign in again to continue."],
    [
      403,
      "invalid_offer",
      "That plan isn't available for this team now. Reload the page and choose a plan again.",
    ],
    [
      400,
      "checkout_rejected",
      "Checkout couldn't start. Choose your plan again.",
    ],
    [
      409,
      "plan_conflict",
      "A plan or payment for this team is already in progress. Check your payment status before you try again.",
    ],
    [
      403,
      "forbidden",
      "You can't change the plan for this team. Ask a team billing administrator, or contact support@superserve.ai.",
    ],
    [429, "rate_limited", "Too many attempts. Wait a minute, then try again."],
  ] as const)(
    "maps API status %s / %s to safe guidance",
    (status, code, expected) => {
      expect(
        checkoutErrorMessage(
          new ApiError(status, code, "plan is not available"),
        ),
      ).toBe(expected)
    },
  )

  it.each([
    [400, "bad_request", "invalid success URL"],
    [400, "invalid_request", "Invalid payment return URL"],
    [
      503,
      "service_unavailable",
      "Pro price configuration requires verification",
    ],
    [500, "internal_error", "Internal detail"],
    [502, "unknown", "Upstream detail"],
    [418, "unknown", "Unknown detail"],
    [400, "bad_request", ""],
  ] as const)("hides raw API text (%s / %s)", (status, code, message) => {
    const result = checkoutErrorMessage(new ApiError(status, code, message))
    expect(result).toBe(generic)
    if (message) expect(result).not.toContain(message)
  })

  it.each([
    new TypeError("Failed to fetch"),
    new SyntaxError("Unexpected token"),
    new DOMException("Aborted", "AbortError"),
    new DOMException("Timed out", "TimeoutError"),
    Object.assign(new Error("Aborted"), { name: "AbortError" }),
    Object.assign(new Error("Timed out"), { name: "TimeoutError" }),
  ])("gives connection guidance for $name", (cause) => {
    expect(checkoutErrorMessage(cause)).toBe(connection)
  })

  it.each(["redacted", undefined])(
    "hides server action errors with a digest (%s)",
    (digest) => {
      expect(
        checkoutErrorMessage(
          Object.assign(new Error("Server detail"), { digest }),
        ),
      ).toBe(generic)
    },
  )

  it.each([
    "Unable to open payment. Check your payment status before trying again.",
    "Your account changed. Reload to continue.",
  ])("preserves console-authored Error copy (%s)", (message) => {
    expect(checkoutErrorMessage(new Error(message))).toBe(message)
  })

  it("hides Zod response validation details", () => {
    const result = z.object({ checkout_url: z.string() }).safeParse({
      checkout_url: 42,
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected validation to fail")
    const message = checkoutErrorMessage(result.error)
    expect(message).toBe(generic)
    expect(message).not.toContain(result.error.message)
    expect(message).not.toContain("checkout_url")
  })

  it("hides custom Error subclass details", () => {
    class X extends Error {}
    const error = new X("Library detail")
    expect(checkoutErrorMessage(error)).toBe(generic)
    expect(checkoutErrorMessage(error)).not.toContain(error.message)
  })

  it.each([
    new Error(""),
    null,
    undefined,
    "Raw failure",
    42,
    { message: "Raw failure" },
  ])("uses generic copy for empty or unrecognized errors (%j)", (cause) =>
    expect(checkoutErrorMessage(cause)).toBe(generic),
  )
})
