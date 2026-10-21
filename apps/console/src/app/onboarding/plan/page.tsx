import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { PlanSelectionLoader } from "@/components/onboarding/plan-selection-loader"
import {
  getSignupPlanPage,
  type SignupPlanPageParams,
} from "@/lib/api/signup-plan-page"
import { trackEvent } from "@/lib/posthog/actions"
import { ycOnboardingDestination } from "@/lib/yc/onboarding"

export const metadata: Metadata = {
  title: "Choose your plan | Superserve",
  robots: { index: false, follow: false },
}

export default async function PlanSelectionPage({
  searchParams,
}: {
  searchParams: Promise<SignupPlanPageParams>
}) {
  const params = await searchParams
  const result = await getSignupPlanPage(params)
  const context = result?.context
  if (context && ["selecting", "pending", "yc_claim"].includes(context.state)) {
    let destination: string | null
    try {
      destination = await ycOnboardingDestination(context)
    } catch {
      return (
        <main className="mx-auto max-w-2xl space-y-4 p-8">
          <h1 className="text-2xl">Checking your plan</h1>
          <p role="alert">
            We could not check your saved offer. Refresh to retry before
            choosing a plan.
          </p>
          <form action="/onboarding/plan" method="get">
            <button className="underline">Refresh</button>
          </form>
        </main>
      )
    }
    if (destination) redirect(destination)
  }
  if (
    context &&
    (context.state === "legacy" ||
      (context.state === "committed" &&
        (context.offer !== "free" ||
          !params.billing ||
          params.billing === "success")))
  ) {
    after(async () => {
      const properties = {
        requested_offer: context.requestedOffer ?? "not_specified",
        selected_offer: context.offer ?? "free",
        billing_cadence: context.offer?.startsWith("pro_")
          ? context.offer.slice(4)
          : undefined,
      }
      if (params.billing)
        await trackEvent("signup_plan_action", context.userId, {
          ...properties,
          action: "checkout_returned",
        })
      await trackEvent("signup_plan_action", context.userId, {
        ...properties,
        action: "completed",
      })
    })
    redirect("/sandboxes")
  }
  return (
    <PlanSelectionLoader
      key={JSON.stringify([context, params])}
      initialContext={context ?? null}
      billingReturn={params.billing}
      expectedTeam={params.team}
      expectedUser={params.account}
    />
  )
}
