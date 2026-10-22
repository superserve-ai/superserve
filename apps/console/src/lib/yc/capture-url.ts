import "server-only"
import { ycBrowserOrigin } from "./browser-origin"

export function ycClaimCaptureURL(): string | null {
  const configured = process.env.YC_CLAIM_WEBSITE_URL
  if (configured === undefined) return "https://www.superserve.ai/yc"
  const origin = ycBrowserOrigin(configured)
  return origin ? `${origin}/yc` : null
}
