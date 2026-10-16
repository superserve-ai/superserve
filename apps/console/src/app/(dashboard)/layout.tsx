import { redirect } from "next/navigation"

import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { PlanSelectionLoader } from "@/components/onboarding/plan-selection-loader"
import { SignupPlanGate } from "@/components/onboarding/signup-plan-gate"
import { QueryProvider } from "@/components/query-provider"
import { TrialBillingBanner } from "@/components/trial-billing-banner"
import {
  getImpersonationContext,
  hasImpersonationCookie,
} from "@/lib/admin/impersonation"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { getSignupPlanPage } from "@/lib/api/signup-plan-page"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const impersonationContext = (await hasImpersonationCookie())
    ? await getImpersonationContext()
    : null
  const signup = impersonationContext ? null : await getSignupPlanPage()
  if (!impersonationContext && !signup)
    return <PlanSelectionLoader initialContext={null} />
  if (signup && needsPlanSelection(signup.context)) redirect("/onboarding/plan")
  const queryScope = impersonationContext?.teamId ?? "self"

  return (
    <QueryProvider
      cacheScope={queryScope}
      initialSignup={signup ?? undefined}
      teamContext={
        impersonationContext
          ? {
              teamId: impersonationContext.teamId,
              region: impersonationContext.region,
              name: impersonationContext.teamName,
            }
          : null
      }
    >
      <SignupPlanGate>
        <DashboardShell
          globalBanner={<TrialBillingBanner />}
          banner={<ImpersonationBanner context={impersonationContext} />}
        >
          {children}
        </DashboardShell>
      </SignupPlanGate>
    </QueryProvider>
  )
}
