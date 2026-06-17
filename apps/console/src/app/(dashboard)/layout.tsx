import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"
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

  return (
    <QueryProvider>
      <ImpersonationBanner />
      <DashboardShell isStaff={isStaff(user)}>{children}</DashboardShell>
    </QueryProvider>
  )
}
