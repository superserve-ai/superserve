"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"

export function SignupPlanGate({ children }: { children: ReactNode }) {
  const scope = useQueryScope()
  if (scope !== "self") return children
  return <SelfSignupPlanGate>{children}</SelfSignupPlanGate>
}

// The dashboard layout checks the team it renders with on the server and seeds
// that answer. This only re-checks after a team switch or a new team, in the
// background: a failed read leaves the console usable and the next full load
// checks again on the server.
function SelfSignupPlanGate({ children }: { children: ReactNode }) {
  const { ready, teamKey } = useBillingContext()
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useQuery({
    queryKey: ["signup-plan", teamKey],
    queryFn: () => getSignupPlanAction(teamKey ?? undefined),
    enabled: ready,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  })
  const required = query.data && needsPlanSelection(query.data)
  useEffect(() => {
    if (required) router.replace("/onboarding/plan")
  }, [required, router])
  return (
    <>
      {searchParams.get("contact_sales") === "1" && (
        <aside className="border-b p-4">
          Your Free account is ready.{" "}
          <a
            className="underline"
            href="https://www.superserve.ai/meet/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Schedule your sales call
          </a>
          .
        </aside>
      )}
      {children}
    </>
  )
}
