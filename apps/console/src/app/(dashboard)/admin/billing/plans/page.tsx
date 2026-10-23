import { notFound } from "next/navigation"

import { getBillingCatalogsAction } from "@/lib/admin/billing-catalog-actions"
import { getImpersonationContext } from "@/lib/admin/impersonation"
import {
  canReadAdminBilling,
  canWriteAdminBilling,
} from "@/lib/admin/permissions"
import { DEFAULT_REGION } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { PlansCatalog } from "./plans-catalog"

export default async function AdminBillingPlansPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!canReadAdminBilling(user)) notFound()
  if (await getImpersonationContext(user))
    return (
      <p className="p-4 text-sm text-muted">
        Stop impersonating the team to manage the plan catalog.
      </p>
    )

  const catalogs = await getBillingCatalogsAction()
  return (
    <PlansCatalog
      catalogs={catalogs}
      canWrite={canWriteAdminBilling(user)}
      previewRegion={DEFAULT_REGION}
    />
  )
}
