import { Button } from "@superserve/ui"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { findActiveTeamForUser } from "@/lib/api/api-key-mint"
import { safeReturnPath } from "@/lib/billing/return-path"
import { configuredRegions } from "@/lib/cells"
import { regionLabel } from "@/lib/format"
import { createServerClient } from "@/lib/supabase/server"

import { chooseFirstTeamRegionAction } from "./actions"

export const metadata: Metadata = {
  title: "Choose your region | Superserve",
  robots: { index: false, follow: false },
}

export default async function RegionSelectionPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next: raw } = await searchParams
  const next = raw && safeReturnPath(raw) === raw ? raw : "/onboarding/plan/"
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    redirect(
      `/auth/signin?next=${encodeURIComponent(`/onboarding/region/?${new URLSearchParams({ next })}`)}`,
    )
  const regions = configuredRegions()
  // The picker only places a first team; anyone with a team moves on.
  if (regions.length < 2 || (await findActiveTeamForUser(user.id)).active)
    redirect(next)

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
        Choose your region.
      </h1>
      <p className="text-muted-foreground mt-4">
        Your team&apos;s sandboxes run here. Pick the one closest to you or your
        users. You can create teams in other regions later from Settings.
      </p>
      <form action={chooseFirstTeamRegionAction} className="mt-10 grid gap-4">
        <input type="hidden" name="next" value={next} />
        {regions.map((region) => (
          <Button
            key={region}
            type="submit"
            name="region"
            value={region}
            variant="outline"
            className="h-14 justify-start text-base"
          >
            {regionLabel(region)}
          </Button>
        ))}
      </form>
    </main>
  )
}
