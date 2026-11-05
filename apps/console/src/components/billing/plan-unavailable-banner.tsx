"use client"

import { Button } from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { useBillingContext } from "@/hooks/use-billing-context"
import type { SignupPlanContext } from "@/lib/api/signup-plan"

import { BannerShell } from "./plan-aware-banner"
import { PlanBanner } from "./plan-banner"

const SUPPORT_EMAIL = "support@superserve.ai"

// The server couldn't read this team's plan, so the console renders without
// it. Nothing here assumes a plan: the signup plan gate still re-checks in the
// background, and the usual plan banner returns once that check answers.
export function PlanUnavailableBanner() {
  const { teamKey } = useBillingContext()
  const router = useRouter()
  const [retrying, startRetry] = useTransition()
  // Observes the gate's query without fetching it a second time.
  const checked = useQuery<SignupPlanContext>({
    queryKey: ["signup-plan", teamKey],
    enabled: false,
  }).data
  if (checked) return <PlanBanner />
  return (
    <BannerShell
      tone="warning"
      label="Plan details unavailable"
      action={
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={() => startRetry(() => router.refresh())}
          >
            {retrying ? "Retrying…" : "Try again"}
          </Button>
          <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
            Contact support
          </a>
        </div>
      }
    >
      We couldn’t load your plan details. Some billing info may be missing. Plan
      and usage: unavailable.
    </BannerShell>
  )
}
