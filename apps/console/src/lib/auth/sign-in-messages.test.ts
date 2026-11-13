import { describe, expect, it } from "vitest"

import { AUTH_MESSAGES, isNetworkAuthError } from "./sign-in-messages"

describe("isNetworkAuthError", () => {
  it("recognizes Supabase rejected fetches by message", () => {
    expect(
      isNetworkAuthError({
        name: "AuthRetryableFetchError",
        status: 0,
        message: "Failed to fetch",
      }),
    ).toBe(true)
  })

  it("does not treat an unparseable status-0 response as a network error", () => {
    expect(
      isNetworkAuthError({
        name: "AuthRetryableFetchError",
        status: 0,
        message: "Unexpected token '<', \"<html>\" is not valid JSON",
      }),
    ).toBe(false)
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
    "The network connection was lost.",
    "The Internet connection appears to be offline.",
    "fetch failed",
    "TypeError: Failed to fetch",
  ])(
    "recognizes the browser fetch failure %s case-insensitively",
    (message) => {
      expect(isNetworkAuthError({ message })).toBe(true)
      expect(isNetworkAuthError({ message: message.toLowerCase() })).toBe(true)
      expect(isNetworkAuthError({ message: message.toUpperCase() })).toBe(true)
      expect(isNetworkAuthError({ message: `  ${message}\n` })).toBe(true)
    },
  )

  it.each([
    { message: "Invalid login credentials" },
    { message: "Request failed: Failed to fetch" },
    { message: "Failed to fetch: server unavailable" },
    { message: "TypeError: Failed to fetch\nUnexpected response" },
    { message: 0 },
    { message: null },
    { name: "AuthRetryableFetchError" },
    { status: 0 },
    {},
    "Failed to fetch",
    0,
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
