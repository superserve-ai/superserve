"use client"

import { Button, Spinner } from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"

import { useBillingCapabilities } from "@/hooks/use-billing-capabilities"
import { useBillingContext } from "@/hooks/use-billing-context"
import { useSubmitOnce } from "@/hooks/use-submit-once"
import { useUser } from "@/hooks/use-user"
import type { SignupPlanContext } from "@/lib/api/signup-plan"
import { pickerOfferSellable, pickerPlanLabel } from "@/lib/billing/plan-picker"
import {
  planPickerPath,
  signupCheckoutPath,
  trialPlanOffer,
} from "@/lib/billing/signup-checkout-paths"

// The trial upgrade action. The banner and the Billing plan card both render
// it, so a trial team sees one upgrade path with one destination.
export function TrialUpgradeAction() {
  const { teamKey } = useBillingContext()
  const offers = useBillingCapabilities().data?.offers
  const signup = useQueryClient().getQueryData<SignupPlanContext>([
    "signup-plan",
    teamKey,
  ])
  const user = useUser().user
  const account = signup?.userId ?? user?.id
  const locator = account && teamKey ? { account, team: teamKey } : null
  const requested = trialPlanOffer(signup?.requestedOffer)
  const selected =
    requested && pickerOfferSellable(offers, requested) ? requested : undefined
  const { submitting, onSubmit } = useSubmitOnce<true>()

  return (
    <>
      {selected && locator ? (
        <form
          method="post"
          action={signupCheckoutPath(selected, locator)}
          onSubmit={onSubmit(true)}
        >
          <Button type="submit" size="sm" disabled={submitting !== null}>
            {submitting ? <Spinner size="sm" /> : null}
            {`Upgrade to ${pickerPlanLabel(offers, selected)}`}
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          render={<Link href={planPickerPath("upgrade", undefined, locator)} />}
        >
          Upgrade
        </Button>
      )}
      {selected && locator ? (
        <Link
          href={planPickerPath("upgrade", selected, locator)}
          className="self-center underline underline-offset-4"
        >
          Other plans
        </Link>
      ) : null}
    </>
  )
}
