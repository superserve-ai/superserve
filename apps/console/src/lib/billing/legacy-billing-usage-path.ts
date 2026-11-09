export function legacyBillingUsagePath(pathname: string): string | null {
  if (pathname !== "/plan-usage" && !pathname.startsWith("/plan-usage/"))
    return null

  return `/billing-usage${pathname.slice("/plan-usage".length)}`
}
