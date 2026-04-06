import { ApiKeyProvider } from "@/components/api-key-provider"
import { DashboardShell } from "@/components/layout/dashboard-shell"
import { QueryProvider } from "@/components/query-provider"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <QueryProvider>
      <ApiKeyProvider>
        <DashboardShell>{children}</DashboardShell>
      </ApiKeyProvider>
    </QueryProvider>
  )
}
