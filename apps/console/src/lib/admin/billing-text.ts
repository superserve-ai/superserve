export const BILLING_KEY_LIMIT = 200
export const BILLING_REASON_LIMIT = 2000

export function withinBillingTextLimit(value: string, limit: number): boolean {
  return value.length <= limit * 2 && [...value].length <= limit
}
