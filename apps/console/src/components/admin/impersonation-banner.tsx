import type { User } from "@supabase/supabase-js"

import { getImpersonationContext } from "@/lib/admin/impersonation"
import { stopImpersonationAction } from "@/lib/admin/teams-actions"

interface ImpersonationBannerProps {
  user: User | null | undefined
}

export async function ImpersonationBanner({ user }: ImpersonationBannerProps) {
  const ctx = await getImpersonationContext(user)
  if (!ctx) return null
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs tracking-tight text-warning uppercase">
      <span>Read-only — viewing team {ctx.teamName}</span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="underline">
          Exit
        </button>
      </form>
    </div>
  )
}
