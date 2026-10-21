import Link from "next/link"
import { redirect } from "next/navigation"

import {
  AcceptanceError,
  ClaimStateError,
  readOffer,
} from "@/lib/yc/acceptance-api"
import { claimID } from "@/lib/yc/staff-schema"

import { OfferJourney } from "./offer-journey"
import { StatusPanel } from "./status-panel"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "Your YC offer | Superserve",
  robots: { index: false, follow: false },
}
export default async function AcceptOfferPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>
}) {
  const { claim } = await searchParams
  if (!claimID.safeParse(claim).success)
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl">Your YC offer</h1>
        <Link className="underline" href="/yc/claim">
          Find your verified claim
        </Link>
      </main>
    )
  let offer
  try {
    offer = await readOffer(claim!)
  } catch (error) {
    if (error instanceof AcceptanceError && error.kind === "signin")
      redirect(
        `/auth/signin?next=${encodeURIComponent(`/yc/accept?claim=${claim}`)}`,
      )
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <StatusPanel
          state={error instanceof ClaimStateError ? error.state : "unavailable"}
        />
        <Link className="underline" href="/yc/claim">
          Check your claim
        </Link>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <OfferJourney
        key={`${offer.user_id}:${offer.acceptance_id}`}
        initial={offer}
      />
    </main>
  )
}
