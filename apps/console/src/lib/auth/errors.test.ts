import { describe, expect, it } from "vitest"

import { isExistingAccountError } from "./errors"

describe("isExistingAccountError", () => {
  it.each([
    {
      message: "A user with this email address has already been registered",
      code: "email_exists",
      status: 422,
    },
    { code: "user_already_exists" },
    { message: "User already registered" },
    { message: "A user with this email address has already been registered" },
    { code: null, message: "User ALREADY REGISTERED" },
    { code: 422, message: "User already registered" },
  ])("recognizes an existing account: %j", (error) => {
    expect(isExistingAccountError(error)).toBe(true)
  })

  it.each([
    { code: "over_email_send_rate_limit", message: "Rate limit exceeded" },
    { code: "other_error", message: "email_exists: User already registered" },
    { code: "", message: "User already registered" },
    { message: "email_exists" },
    { message: 422 },
    {},
    null,
    undefined,
    "User already registered",
    422,
    false,
  ])("rejects unrelated errors and non-objects: %j", (error) => {
    expect(isExistingAccountError(error)).toBe(false)
  })
})
