import {
  AuthenticationError,
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
