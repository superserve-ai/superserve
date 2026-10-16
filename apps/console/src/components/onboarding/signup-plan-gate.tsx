"use client"

import { Button } from "@superserve/ui"
import { useIsMutating, useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { Spinner } from "@/components/icons"
import { useQueryScope } from "@/components/query-provider"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useTeams } from "@/hooks/use-teams"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { getSignupPlanAction } from "@/lib/api/signup-plan-actions"

export function SignupPlanGate({ children }: { children: ReactNode }) {
  const scope = useQueryScope()
  if (scope !== "self") return children
  return <SelfSignupPlanGate>{children}</SelfSignupPlanGate>
}

function SelfSignupPlanGate({ children }: { children: ReactNode }) {
  const { ready, teamKey } = useBillingContext()
  const teams = useTeams()
  const switching = useIsMutating({ mutationKey: ["switch-team"] }) > 0
  // First sign-in can precede team provisioning. Resolve through the existing
  // authenticated provisioning path rather than waiting for gated children.
  const bootstrap = !teams.isPending && !teams.isError && !teamKey && !switching
  const canRead = ready || bootstrap
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useQuery({
    queryKey: ["signup-plan", teamKey],
    queryFn: async () => {
      const context = await getSignupPlanAction(teamKey ?? undefined)
      // Provisioning can create the first team after the directory cached an
      // empty result. Reconcile that cache before exposing team-scoped pages.
      if (bootstrap) await teams.refetch({ throwOnError: true })
      return context
    },
    enabled: canRead,
    staleTime: 0,
    refetchOnMount: false,
    retry: false,
  })
  const required = query.data && needsPlanSelection(query.data)
  useEffect(() => {
    if (canRead && required) router.replace("/onboarding/plan")
  }, [canRead, required, router])
  if (query.isError || teams.isError)
    return (
      <main className="p-10">
        <p role="alert">Unable to check your account setup.</p>
        <Button
          className="mt-4"
          onClick={() => {
            void teams.refetch()
            if (canRead) void query.refetch()
          }}
        >
          Try again
        </Button>
      </main>
    )
  if (!canRead || !query.data || required)
    return (
      <main
        className="flex min-h-dvh items-center justify-center"
        aria-busy="true"
      >
        <output aria-label="Loading team">
          <Spinner />
        </output>
      </main>
    )
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
