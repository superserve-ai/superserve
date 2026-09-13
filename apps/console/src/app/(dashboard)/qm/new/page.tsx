"use client"

import { ArrowLeftIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { PageHeader } from "@/components/page-header"
import { CreateTenantForm } from "@/components/qm/create-tenant-form"
import { useDashboardTeamContext } from "@/components/query-provider"
import { useQmTenants } from "@/hooks/use-qm-tenants"
import { useUser } from "@/hooks/use-user"

export default function NewQmTenantPage() {
  const router = useRouter()
  const { user } = useUser()
  // Always hit the server: a stack created in another tab or session must
  // be seen even when /qm left a fresh, empty list in the cache.
  const tenants = useQmTenants({ refetchOnMount: "always" })
  // Viewing another team is read-only at the proxy: don't invite an
  // operator to paste a provider key into a form that cannot submit.
  const readOnly = useDashboardTeamContext() !== null

  // qm-api allows one live stack per team. Rather than let someone fill in
  // the form (and paste a provider key) only to hit a 409, send them to the
  // stack they already have. A failed list still shows the form; the
  // server remains the authority.
  const existing = tenants.data?.find((t) => t.status !== "deleted") ?? null
  // Hold the form until this mount's own fetch has answered; a failed
  // fetch still shows it, since the server remains the authority.
  const verified = tenants.isFetchedAfterMount || tenants.isError
  useEffect(() => {
    if (existing) router.replace(`/qm/${existing.id}`)
  }, [existing, router])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="New QM stack">
        <Link
          href="/qm"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted uppercase transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" weight="light" />
          Back
        </Link>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        {readOnly ? (
          <output className="mx-auto block w-full max-w-2xl px-4 py-6 text-sm text-muted">
            Stacks can&apos;t be created while viewing another team.
          </output>
        ) : !verified || existing ? (
          <FormSkeleton />
        ) : (
          <CreateTenantForm defaultAdminEmail={user?.email ?? null} />
        )}
      </div>
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="border border-dashed border-border">
          <div className="flex h-10 items-center border-b border-dashed border-border px-4">
            <div className="h-2.5 w-24 animate-pulse bg-muted/20" />
          </div>
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="h-3 w-32 animate-pulse bg-muted/20" />
            <div className="h-9 animate-pulse bg-muted/10" />
          </div>
        </div>
      ))}
    </div>
  )
}
