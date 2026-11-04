import { CheckIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@superserve/ui"
import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"

import { findActiveTeamForUser } from "@/lib/api/api-key-mint"
import { safeReturnPath } from "@/lib/billing/return-path"
import { configuredRegions } from "@/lib/cells"
import { regionLabel } from "@/lib/format"
import { createServerClient } from "@/lib/supabase/server"

import { chooseFirstTeamRegionAction } from "./actions"

// Where each cell's sandboxes run.
const REGION_PLACES: Record<string, { name: string; code: string }> = {
  use: { name: "GCP N. Virginia", code: "us-east4" },
  usw: { name: "GCP Los Angeles", code: "us-west2" },
}

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
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
        Choose your region.
      </h1>
      <p className="text-muted-foreground mt-4">
        Your team&apos;s sandboxes run here. Pick the one closest to you or your
        users.
      </p>
      <form action={chooseFirstTeamRegionAction} className="mt-10">
        <input type="hidden" name="next" value={next} />
        <fieldset>
          <legend className="text-muted-foreground mb-2 font-mono text-xs tracking-widest uppercase">
            United States
          </legend>
          {regions.map((region, index) => (
            <label
              key={region}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name="region"
                value={region}
                defaultChecked={index === 0}
                className="peer sr-only"
              />
              <Image
                src="/regions/us.svg"
                alt=""
                width={20}
                height={15}
                className="rounded-[2px]"
              />
              <Image
                src="/regions/google-cloud.svg"
                alt=""
                width={18}
                height={14}
              />
              <span>{REGION_PLACES[region]?.name ?? regionLabel(region)}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {REGION_PLACES[region]?.code}
              </span>
              <CheckIcon
                aria-hidden
                className="ml-auto opacity-0 peer-checked:opacity-100"
              />
            </label>
          ))}
        </fieldset>
        <Button type="submit" className="mt-8 w-full">
          Continue
        </Button>
      </form>
    </main>
  )
}
