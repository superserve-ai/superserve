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
      !["billing", "team", "return"].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      return null
  }
  const billing = url.searchParams.get("billing")
  if (billing !== null && billing !== "success" && billing !== "cancel")
    return null
  const returnTo = url.searchParams.get("return")
  if (returnTo !== null && safeReturnPath(returnTo) !== returnTo) return null
  return url.pathname + url.search
}
