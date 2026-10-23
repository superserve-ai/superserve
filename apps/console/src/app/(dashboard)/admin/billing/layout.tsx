import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { canReadAdminBilling } from "@/lib/admin/permissions"
import { createServerClient } from "@/lib/supabase/server"

import { BillingNav } from "./billing-nav"

export const metadata: Metadata = {
  title: "Billing admin",
}

export const dynamic = "force-dynamic"

export default async function AdminBillingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!canReadAdminBilling(user)) notFound()

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Billing" />
      <BillingNav />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
