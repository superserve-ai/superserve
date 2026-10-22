"use server"

import { decideStaffClaim, StaffRequestError } from "@/lib/yc/staff-api"
import type { StaffDecision } from "@/lib/yc/staff-schema"

export async function submitStaffDecision(
  decision: StaffDecision,
  region: string,
) {
  try {
    const claim = await decideStaffClaim(decision, region)
    return { kind: "saved" as const, claim }
  } catch (error) {
    return {
      kind:
        error instanceof StaffRequestError
          ? error.kind
          : ("unavailable" as const),
    }
  }
}
