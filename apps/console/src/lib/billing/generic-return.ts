// Generic card setup never owns an existing Pro or credit-purchase callback.
export function genericBillingReturnState(
  params: URLSearchParams,
  marker: "billing_flow" | "billing" = "billing_flow",
) {
  const values = params.getAll(marker)
  return values.length === 1 &&
    ["success", "cancel", "portal-return"].includes(values[0]!)
    ? values[0]!
    : null
}
