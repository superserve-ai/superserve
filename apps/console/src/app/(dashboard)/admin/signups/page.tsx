import { notFound } from "next/navigation"

import {
  type EnterprisePlanVersion,
  listEnterprisePlanVersions,
} from "@/lib/admin/enterprise-plan"
import { canApprovePlatformSignups } from "@/lib/admin/permissions"
import { listPendingSignups } from "@/lib/admin/signup-approval"
import {
  approveSignupAction,
  rejectSignupAction,
} from "@/lib/admin/signups-actions"
import { createServerClient } from "@/lib/supabase/server"

import { PendingSignupsTable } from "./pending-signups-table"

export const dynamic = "force-dynamic"

export default async function PendingSignupsPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!canApprovePlatformSignups(user)) {
    notFound()
  }

  const [pending, versions] = await Promise.all([
    listPendingSignups(),
    listEnterprisePlanVersions().catch((): EnterprisePlanVersion[] => []),
  ])
  return (
    <PendingSignupsTable
      pending={pending}
      versions={versions}
      onApprove={approveSignupAction}
      onReject={rejectSignupAction}
    />
  )
}
