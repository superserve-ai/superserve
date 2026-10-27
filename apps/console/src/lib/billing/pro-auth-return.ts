import { genericBillingReturnState } from "./generic-return"
import { safeReturnPath } from "./return-path"

export function proAuthReturnPath(raw: string | null): string | null {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(raw)
  )
    return null
  const url = new URL(raw, "https://console.invalid")
  if (!/^\/billing\/pro\/?$/.test(url.pathname) || url.hash) return null
  for (const key of url.searchParams.keys()) {
    if (
      !["billing", "team", "return", "billing_flow"].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      return null
  }
  if (
    url.searchParams.has("billing_flow") &&
    !genericBillingReturnState(url.searchParams)
  )
    return null
  const billing = url.searchParams.get("billing")
  if (billing !== null && billing !== "success" && billing !== "cancel")
    return null
  const returnTo = url.searchParams.get("return")
  if (returnTo !== null && safeReturnPath(returnTo) !== returnTo) return null
  return url.pathname + url.search
}

export function starterAuthReturnPath(raw: string | null): string | null {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(raw)
  )
    return null
  const url = new URL(raw, "https://console.invalid")
  if (!/^\/plan-usage\/buy-credit\/?$/.test(url.pathname) || url.hash)
    return null
  for (const key of url.searchParams.keys()) {
    if (
      ![
        "purchase",
        "team",
        "amount",
        "purchase_id",
        "billing",
        "billing_flow",
      ].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      return null
  }
  if (
    url.searchParams.has("billing_flow") &&
    !genericBillingReturnState(url.searchParams)
  )
    return null
  if (
    url.searchParams.has("billing") &&
    !genericBillingReturnState(url.searchParams, "billing")
  )
    return null
  const purchase = url.searchParams.get("purchase")
  if (purchase !== null && purchase !== "success" && purchase !== "cancel")
    return null
  return url.pathname + url.search
}

// Only this bounded preparation route may survive an authentication callback.
// The account locator is checked against the fresh Auth user by the action;
// nested navigation intent never authorizes a payment or a plan assignment.
export function signupPreparationReturnPath(raw: string | null): string | null {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(raw)
  )
    return null
  const url = new URL(raw, "https://console.invalid")
  if (!/^\/api\/onboarding\/prepare\/?$/.test(url.pathname) || url.hash)
    return null
  for (const key of url.searchParams.keys()) {
    if (
      !["account", "team", "billing", "next"].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      return null
  }
  const account = url.searchParams.get("account")
  if (!account || !/^[a-zA-Z0-9_-]{1,128}$/.test(account)) return null
  const next =
    proAuthReturnPath(url.searchParams.get("next")) ??
    starterAuthReturnPath(url.searchParams.get("next"))
  if (!next) return null
  const team = url.searchParams.get("team")
  if (
    team !== null &&
    (!team || team.length > 256 || /[\\\u0000-\u0020\u007f]/.test(team))
  )
    return null
  const nestedTeam = new URL(next, "https://console.invalid").searchParams.get(
    "team",
  )
  if (team && nestedTeam && team !== nestedTeam) return null
  const billing = url.searchParams.get("billing")
  if (billing !== null && billing !== "success" && billing !== "cancel")
    return null
  return url.pathname + url.search
}
