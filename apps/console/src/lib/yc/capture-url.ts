import "server-only"

export function ycClaimCaptureURL(): string | null {
  const configured = process.env.YC_CLAIM_WEBSITE_URL
  if (configured === undefined) return "https://www.superserve.ai/yc"
  // Configuration is an origin, never a browser-provided destination or path.
  if (!/^https:\/\/[^/?#@\\\s]+\/?$/.test(configured)) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return `${url.origin}/yc`
  } catch {
    return null
  }
}
