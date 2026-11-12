"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"
import { awaitingPlanRedirect } from "@/lib/billing/signup-checkout-paths"

// Every observer of this query shares these options: an observer without them
// would replace the query function under a read the gate still retries.
export function signupPlanQuery(teamKey: string | null) {
  return {
    queryKey: ["signup-plan", teamKey],
    queryFn: () => getSignupPlanAction(teamKey ?? undefined),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  }
}

export function SignupPlanGate({ children }: { children: ReactNode }) {
  const scope = useQueryScope()
  if (scope !== "self") return children
  return <SelfSignupPlanGate>{children}</SelfSignupPlanGate>
}

// The dashboard layout checks the team it renders with on the server and seeds
// that answer, sending a team whose trial ended to the plan picker. This only re-checks after a team switch, a new team, or a
// server read that failed, in the background: a failed read leaves the
// console usable and the next full load checks again on the server.
function SelfSignupPlanGate({ children }: { children: ReactNode }) {
  const { ready, teamKey } = useBillingContext()
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useQuery({ ...signupPlanQuery(teamKey), enabled: ready })
  const required = query.data && needsPlanSelection(query.data)
  const picker = query.data ? awaitingPlanRedirect(query.data) : null
  useEffect(() => {
    if (required) router.replace("/onboarding/plan")
    else if (picker) router.replace(picker)
  }, [required, picker, router])
  return (
    <>
      {searchParams.get("contact_sales") === "1" && (
        <aside className="border-b p-4">
          {/* Name the plan only once it has been read. */}
          {query.data
            ? "Your Free account is ready."
            : "Your account is ready."}{" "}
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
