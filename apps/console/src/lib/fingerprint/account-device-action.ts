"use server"

import { recordExistingAccountDevice } from "@/lib/api/promotion-device-evidence"

import { verifiedAccountDevice } from "./observe"

/** Best effort: a missing or unverifiable device never affects the session. */
export async function recordAccountDevice(
  userId: string,
  eventId: string,
): Promise<boolean> {
  try {
    const fingerprint = await verifiedAccountDevice(eventId, userId)
    return fingerprint
      ? await recordExistingAccountDevice(userId, fingerprint)
      : false
  } catch {
    return false
  }
}
