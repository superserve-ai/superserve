import { redirect } from "next/navigation"

import { AccountDeviceRecorder } from "@/components/account-device-recorder"
import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { PlanBanner } from "@/components/billing/plan-banner"
import { PlanUnavailableBanner } from "@/components/billing/plan-unavailable-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { SessionExpiryRedirect } from "@/components/layout/session-expiry-redirect"
import { PlanSelectionLoader } from "@/components/onboarding/plan-selection-loader"
import { SignupPlanGate } from "@/components/onboarding/signup-plan-gate"
import { QueryProvider } from "@/components/query-provider"
import {
  getImpersonationContext,
  hasImpersonationCookie,
} from "@/lib/admin/impersonation"
import { needsPlanSelection } from "@/lib/api/signup-plan"
import { getSignupPlanPageState } from "@/lib/api/signup-plan-page"
import { awaitingPlanRedirect } from "@/lib/billing/signup-checkout-paths"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const impersonationContext = (await hasImpersonationCookie())
    ? await getImpersonationContext()
    : null
  const state = impersonationContext ? null : await getSignupPlanPageState()
  if (state?.status === "blocked")
    return <PlanSelectionLoader initialContext={null} />
  // A plan read that failed twice leaves the console usable without its plan.
  // The client gate re-checks it, and nothing is unlocked by the failure.
  const unavailable = state?.status === "unavailable"
  const signup = state?.status === "ready" ? state.page : null
  if (signup && needsPlanSelection(signup.context)) redirect("/onboarding/plan")
  const picker = signup ? awaitingPlanRedirect(signup.context) : null
  if (picker) redirect(picker)
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
      <SessionExpiryRedirect />
      {!impersonationContext && <AccountDeviceRecorder />}
      <SignupPlanGate>
        <DashboardShell
          globalBanner={
            unavailable ? <PlanUnavailableBanner /> : <PlanBanner />
          }
          banner={<ImpersonationBanner context={impersonationContext} />}
        >
          {children}
        </DashboardShell>
      </SignupPlanGate>
    </QueryProvider>
  )
}
