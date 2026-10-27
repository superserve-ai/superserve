import { genericBillingReturnState } from "./generic-return"
import { proAuthReturnPath, starterAuthReturnPath } from "./pro-auth-return"
import { safeReturnPath } from "./return-path"

export function checkoutTeamReference(value: string | null | undefined) {
  const match =
    /^([a-z][a-z0-9-]{1,15}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      value ?? "",
    )
  return match ? { region: match[1]!, teamId: match[2]! } : null
}

// Only direct checkout callbacks can be retained through account recovery.
export function checkoutRecoveryPath(path: string): string | null {
  if (safeReturnPath(path) !== path) return null
  const url = new URL(path, "https://console.invalid")
  const starter = url.pathname === "/plan-usage/buy-credit/"
  if (!starter && url.pathname !== "/billing/pro/") return null
  if (url.hash) return null
  const params = url.searchParams
  const allowed = starter
    ? ["purchase", "team", "purchase_id", "amount", "billing_flow"]
    : ["billing", "team", "return", "billing_flow"]
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return null
  }
  if (params.has("billing_flow") && !genericBillingReturnState(params))
    return null
  if (!checkoutTeamReference(params.get("team"))) return null
  if (
    !["success", "cancel"].includes(
      params.get(starter ? "purchase" : "billing") ?? "",
    )
  )
    return null
  const returnTo = params.get("return")
  if (returnTo !== null && safeReturnPath(returnTo) !== returnTo) return null
  const purchaseId = params.get("purchase_id")
  if (purchaseId !== null && !checkoutTeamReference(`use:${purchaseId}`))
    return null
  return `${url.pathname}${url.search}`
}

// Setup can pin a fresh paid-plan destination before checkout has started.
// A result marker or purchase identity must never fall back to fresh entry.
export function checkoutEntryPath(path: string): string | null {
  const safe = proAuthReturnPath(path) ?? starterAuthReturnPath(path)
  if (!safe) return null
  const url = new URL(safe, "https://console.invalid")
  if (
    url.searchParams.has("billing") ||
    url.searchParams.has("purchase") ||
    url.searchParams.has("purchase_id")
  )
    return null
  if (!checkoutTeamReference(url.searchParams.get("team"))) return null
  return safe
}

export { genericBillingReturnState } from "./generic-return"
