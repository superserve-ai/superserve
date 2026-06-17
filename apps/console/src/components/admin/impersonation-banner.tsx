import { getImpersonationContext } from "@/lib/admin/impersonation"
import { stopImpersonationAction } from "@/lib/admin/teams-actions"

export async function ImpersonationBanner() {
  const ctx = await getImpersonationContext()
  if (!ctx) return null
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs tracking-tight text-warning uppercase">
      <span>Read-only — viewing team {ctx.teamName}</span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="underline">
          Exit
        </button>
      </form>
    </div>
  )
}
