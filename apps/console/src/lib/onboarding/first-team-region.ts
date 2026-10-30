import "server-only"
import crypto from "node:crypto"

import { cookies } from "next/headers"

import { configuredRegions, DEFAULT_REGION } from "@/lib/cells"

export const FIRST_TEAM_REGION_COOKIE = "ss-first-team-region"

/** A user with no team must pick a region before their first team is created. */
export class FirstTeamRegionRequiredError extends Error {
  constructor() {
    super("Choose a region for your first team")
  }
}

export function firstTeamRegionPath(next: string): string {
  return `/onboarding/region/?${new URLSearchParams({ next })}`
}

// The choice names its user, so another account on the same browser never
// inherits it.
export function firstTeamRegionValue(userId: string, region: string): string {
  return `${userId}:${region}`
}

export async function readFirstTeamRegion(
  userId: string,
): Promise<string | null> {
  const value = (await cookies()).get(FIRST_TEAM_REGION_COOKIE)?.value
  const region = value?.startsWith(`${userId}:`)
    ? value.slice(userId.length + 1)
    : null
  return region && configuredRegions().includes(region) ? region : null
}

/**
 * Where a user's automatic first team is created. East keeps the user-id
 * creation locator; any other region needs its own id, derived so a retry
 * recovers the same creation instead of starting a second one.
 */
export async function firstTeamTarget(
  userId: string,
): Promise<{ region: string; operationId?: string }> {
  const region = await readFirstTeamRegion(userId)
  if (!region) {
    if (configuredRegions().length > 1) throw new FirstTeamRegionRequiredError()
    return { region: DEFAULT_REGION }
  }
  if (region === DEFAULT_REGION) return { region }
  const hex = crypto
    .createHash("sha256")
    .update(`first-team:${userId}:${region}`)
    .digest("hex")
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return {
    region,
    operationId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  }
}
