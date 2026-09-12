"use client"

import { ArrowLeftIcon } from "@phosphor-icons/react"
import Link from "next/link"

import { PageHeader } from "@/components/page-header"
import { CreateTenantForm } from "@/components/qm/create-tenant-form"
import { useUser } from "@/hooks/use-user"

export default function NewQmTenantPage() {
  const { user } = useUser()

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
        <CreateTenantForm defaultAdminEmail={user?.email ?? null} />
      </div>
    </div>
  )
}
