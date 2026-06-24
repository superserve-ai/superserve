import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"
import { getImpersonationContext } from "@/lib/admin/impersonation"
import { isStaff } from "@/lib/admin/staff"
import { createServerClient } from "@/lib/supabase/server"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Resolve once: the banner and the client impersonation context share it.
  const impersonationCtx = await getImpersonationContext(user)

  return (
    <QueryProvider>
      <DashboardShell
        isStaff={isStaff(user)}
        impersonation={{
          isImpersonating: impersonationCtx !== null,
          teamName: impersonationCtx?.teamName ?? null,
        }}
        banner={<ImpersonationBanner ctx={impersonationCtx} />}
      >
        {children}
      </DashboardShell>
    </QueryProvider>
  )
}
