import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import {
  isStorageUnavailable,
  retryBillingUsageQuery,
} from "./billing-query-retry"

describe("billing usage retries", () => {
  it("stops immediately only for explicit missing storage measurements", () => {
    const unavailable = new ApiError(503, "storage_unavailable", "Unavailable")
    expect(isStorageUnavailable(unavailable)).toBe(true)
    expect(retryBillingUsageQuery(0, unavailable)).toBe(false)
    expect(
      retryBillingUsageQuery(0, new ApiError(503, "overloaded", "Retry")),
    ).toBe(true)
    expect(isStorageUnavailable(new Error("storage_unavailable"))).toBe(false)
  })

  it.each([401, 409])("preserves the nonretryable %s response", (status) => {
    expect(
      retryBillingUsageQuery(0, new ApiError(status, "error", "Error")),
    ).toBe(false)
  })

  it("keeps the bounded retry budget for other failures", () => {
    expect(retryBillingUsageQuery(2, new Error("Network"))).toBe(true)
    expect(retryBillingUsageQuery(3, new Error("Network"))).toBe(false)
  })
})

it("does not repeat a billing request after the API deadline aborts it", () => {
  expect(
    retryBillingUsageQuery(0, new DOMException("Aborted", "AbortError")),
  ).toBe(false)
})

it("honors configured retry policies for other errors", () => {
  const error = new Error("Network")
  expect(retryBillingUsageQuery(0, error, false)).toBe(false)
  expect(retryBillingUsageQuery(2, error, 2)).toBe(false)
  const policy = vi.fn(() => true)
  expect(retryBillingUsageQuery(4, error, policy)).toBe(true)
  expect(policy).toHaveBeenCalledWith(4, error)
  expect(
    retryBillingUsageQuery(
      0,
      new ApiError(503, "storage_unavailable", "Unavailable"),
      true,
    ),
  ).toBe(false)
})
