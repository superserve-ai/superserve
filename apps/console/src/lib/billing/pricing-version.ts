import "server-only"
import { cellFor, DEFAULT_REGION } from "@/lib/cells"

const SWITCH_CACHE_SECONDS = 30

/**
 * Whether the region runs pricing v2. Anything but an explicit "v2" from the
 * billing API, including an unreachable API, keeps today's flows.
 */
export async function isPricingV2Enabled(
  region: string = DEFAULT_REGION,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${cellFor(region).apiBaseUrl}/billing/plans/public`,
      { next: { revalidate: SWITCH_CACHE_SECONDS } },
    )
    if (!response.ok) return false
    const body = (await response.json()) as { pricing_version?: unknown }
    return body.pricing_version === "v2"
  } catch {
    console.warn("Pricing version unavailable; using legacy signup flows")
    return false
  }
}
