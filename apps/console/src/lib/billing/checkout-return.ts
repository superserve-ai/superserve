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
    ? ["purchase", "team", "purchase_id", "amount"]
    : ["billing", "team", "return"]
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return null
  }
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
