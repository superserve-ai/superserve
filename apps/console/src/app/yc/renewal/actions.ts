"use server"

import { AcceptanceError } from "@/lib/yc/acceptance-api"
import { submitRenewal } from "@/lib/yc/renewal-api"
import type { RenewalInput } from "@/lib/yc/renewal-schema"

export async function saveRenewal(input: RenewalInput) {
  try {
    return { kind: "saved" as const, renewal: await submitRenewal(input) }
  } catch (error) {
    return {
      kind:
        error instanceof AcceptanceError
          ? error.kind
          : ("unavailable" as const),
    }
  }
}
