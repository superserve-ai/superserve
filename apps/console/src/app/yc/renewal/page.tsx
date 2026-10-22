import Link from "next/link"

import { openOfferBilling } from "@/app/yc/accept/actions"
import { readRenewal, renewalEnabled } from "@/lib/yc/renewal-api"
import { claimID } from "@/lib/yc/staff-schema"

import { RenewalForm } from "./renewal-form"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "Your next plan | Superserve",
  robots: { index: false, follow: false },
}
export default async function RenewalPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>
}) {
  const { claim } = await searchParams
  if (!renewalEnabled()) {
    const locator = claimID.safeParse(claim)
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl">Your next plan</h1>
        <p>
          Renewal choices are not available right now. You can still check your
          current offer and access status.
        </p>
        <Link
          href={
            locator.success ? `/yc/accept?claim=${locator.data}` : "/yc/claim"
          }
          className="underline"
        >
          {locator.success ? "View offer and access status" : "Find your claim"}
        </Link>
      </main>
    )
  }
  let renewal
  try {
    renewal = await readRenewal(claimID.parse(claim))
  } catch {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl">Your next plan</h1>
        <p role="alert">
          We could not check your renewal options. A requested change is not
          confirmed until it appears in your saved renewal status.
        </p>
        <Link href="/yc/claim" className="underline">
          Check your claim
        </Link>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <RenewalForm
        key={`${renewal.acceptance_id}:${renewal.choice_revision}`}
        initial={renewal}
        claim={claim!}
      />
      <form action={openOfferBilling.bind(null, claim!)}>
        <button className="underline">Manage payment in team billing</button>
      </form>
    </main>
  )
}
