import type { ImpersonationContext } from "@/lib/admin/impersonation"
import { stopImpersonationAction } from "@/lib/admin/teams-actions"

interface ImpersonationBannerProps {
  ctx: ImpersonationContext | null
}

export function ImpersonationBanner({ ctx }: ImpersonationBannerProps) {
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
