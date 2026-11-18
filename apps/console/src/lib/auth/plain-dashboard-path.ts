const PLAIN_DASHBOARD_SECTIONS = [
  "/sandboxes",
  "/templates",
  "/secrets",
  "/snapshots",
  "/audit-logs",
  "/api-keys",
  "/settings",
  "/team",
  "/get-started",
  "/billing-usage",
]

const EXCLUDED_DASHBOARD_SECTIONS = [
  "/billing-usage/buy-credit",
  "/billing-usage/upgrade",
]

// These dashboard pages let sign-in choose the team they open.
export function isPlainDashboardPath(path: string): boolean {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(path) ||
    path.split(/[?#]/, 1)[0].includes("%")
  )
    return false

  const url = new URL(path, "https://example.com")
  if (url.searchParams.has("team") || url.searchParams.has("account"))
    return false

  const pathname = url.pathname.replace(/\/+$/, "") || "/"
  if (
    EXCLUDED_DASHBOARD_SECTIONS.some(
      (section) => pathname === section || pathname.startsWith(`${section}/`),
    )
  )
    return false

  return (
    pathname === "/" ||
    PLAIN_DASHBOARD_SECTIONS.some(
      (section) => pathname === section || pathname.startsWith(`${section}/`),
    )
  )
}
