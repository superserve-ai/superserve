"use client"

import { useQueryClient } from "@tanstack/react-query"

import { isLegacyTransition } from "@/lib/api/billing-capabilities"
import type { SignupPlanContext } from "@/lib/api/signup-plan"

import { useBillingCapabilities } from "./use-billing-capabilities"
import { useBillingContext } from "./use-billing-context"

export function useLegacyPlanTransition(): boolean {
  const capabilities = useBillingCapabilities()
  const { teamKey } = useBillingContext()
  const signup = useQueryClient().getQueryData<SignupPlanContext>([
    "signup-plan",
    teamKey,
  ])
  return (
    isLegacyTransition(capabilities.data) || signup?.legacyPlanEntry === true
  )
}
