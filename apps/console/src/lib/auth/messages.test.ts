import { describe, expect, it } from "vitest"

import { AUTH_MESSAGES, isNetworkAuthError } from "./messages"

describe("isNetworkAuthError", () => {
  it("recognizes Supabase rejected fetches by class and status", () => {
    expect(
      isNetworkAuthError({
        name: "AuthRetryableFetchError",
        status: 0,
        message: "Connection lost",
      }),
    ).toBe(true)
  })

  it.each([502, 503, 504, 520, 530])(
    "does not treat a retryable HTTP %s error as a network error",
    (status) => {
      expect(
        isNetworkAuthError({
          name: "AuthRetryableFetchError",
          status,
          message: "Service Unavailable",
        }),
      ).toBe(false)
    },
  )

  it.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ])(
    "recognizes the browser fetch failure %s case-insensitively",
    (message) => {
      expect(isNetworkAuthError({ message })).toBe(true)
      expect(isNetworkAuthError({ message: message.toLowerCase() })).toBe(true)
      expect(isNetworkAuthError({ message: message.toUpperCase() })).toBe(true)
    },
  )

  it.each([
    { message: "Invalid login credentials" },
    { name: "AuthRetryableFetchError" },
    { status: 0 },
    {},
    null,
    undefined,
  ])(
    "does not classify other or missing errors as network errors: %j",
    (error) => {
      expect(isNetworkAuthError(error)).toBe(false)
    },
  )
})

describe("AUTH_MESSAGES", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(AUTH_MESSAGES)).toBe(true)
  })

  it.each(Object.values(AUTH_MESSAGES))(
    "does not use vague retry copy: %s",
    (message) => {
      expect(message).not.toContain("Please try again")
    },
  )
})
