export function isBuyCreditPath(pathname: string): boolean {
  return /^\/(?:billing-usage|plan-usage)\/buy-credit\/?$/.test(pathname)
}
