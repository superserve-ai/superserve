import { ApiError } from "@/lib/api/client"

export function isStorageUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 503 &&
    error.code === "storage_unavailable"
  )
}

export function isBillingUsageUnavailable(error: unknown): boolean {
  return (
    isStorageUnavailable(error) ||
    (error instanceof Error && error.name === "AbortError")
  )
}

// Missing measurements need a fresh observation, not an immediate retry loop.
// Other failures keep the console's existing retry policy.
export function retryBillingUsageQuery(
  failureCount: number,
  error: Error,
  retry?: boolean | number | ((failureCount: number, error: Error) => boolean),
) {
  if (isBillingUsageUnavailable(error)) return false
  if (typeof retry === "function") return retry(failureCount, error)
  if (typeof retry === "boolean") return retry
  if (typeof retry === "number") return failureCount < retry
  if (error instanceof ApiError && [401, 409].includes(error.status))
    return false
  return failureCount < 3
}
