/** Internal routing optimization; the server alone verifies the signature. */
export interface RoutingHintDeps {
  getRoutingHint?: () => string | undefined
}

export function routingHintHeaders(
  deps: RoutingHintDeps,
): Record<string, string> {
  const hint = deps.getRoutingHint?.()
  return hint ? { "X-Superserve-Routing-Hint": hint } : {}
}

export function routingHintExpired(deps: RoutingHintDeps): boolean {
  const hint = deps.getRoutingHint?.()
  if (!hint) return false
  try {
    const payload = hint.split(".")[1]!
    const value = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    )
    return typeof value.e === "number" && value.e <= Date.now() / 1000
  } catch {
    return false
  }
}
