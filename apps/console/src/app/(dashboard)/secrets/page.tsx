"use client"

import { VaultIcon } from "@phosphor-icons/react"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"

export default function SecretsPage() {
  return (
    <>
      <PageHeader title="Secrets" />
      <EmptyState
        icon={VaultIcon}
        title="Secrets coming soon"
        description="Encrypted credentials your agents can use without ever seeing the value. The full UI lands in the next release."
      />
    </>
  )
}
