"use client"

import {
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  RocketLaunchIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button, useToast } from "@superserve/ui"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { BuildHistorySection } from "@/components/templates/build-history-section"
import { CurrentBuildPanel } from "@/components/templates/current-build-panel"
import { DeleteTemplateDialog } from "@/components/templates/delete-template-dialog"
import { TemplateInfoGrid } from "@/components/templates/template-info-grid"
import { TemplateStatusBadge } from "@/components/templates/template-status-badge"
import { useRebuildTemplate, useTemplate } from "@/hooks/use-templates"

function CopyButton({ text }: { text: string }) {
  const { addToast } = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    addToast("ID copied", "success")
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy ID"}
      className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-muted transition-colors hover:text-foreground"
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <CheckIcon className="size-3.5 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-3.5" weight="light" />
      )}
    </button>
  )
}

export default function TemplateDetailPage() {
  const params = useParams<{ template_id: string }>()
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data, isPending, error, refetch } = useTemplate(
    params?.template_id ?? null,
  )
  const rebuild = useRebuildTemplate()

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Template" />
        <div className="flex-1 animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Template" />
        <ErrorState
          title="Template not found"
          message={
            error instanceof Error
              ? error.message
              : "This template could not be loaded."
          }
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const rebuildDisabled =
    rebuild.isPending || data.status === "building" || data.status === "pending"

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={data.alias}>
        <div className="flex items-center gap-2">
          {data.status === "ready" && (
            <Button
              size="sm"
              onClick={() =>
                router.push(
                  `/sandboxes?from_template=${encodeURIComponent(data.alias)}`,
                )
              }
            >
              <RocketLaunchIcon className="size-3.5" weight="light" />
              Launch sandbox
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => rebuild.mutate(data.id)}
            disabled={rebuildDisabled}
          >
            <ArrowsClockwiseIcon className="size-3.5" weight="light" />
            Rebuild
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon className="size-3.5" weight="light" />
            Delete
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-center gap-4">
            <Link
              href="/templates"
              className="font-mono text-[11px] uppercase text-muted transition-colors hover:text-foreground"
            >
              ← Templates
            </Link>
            <span className="font-mono text-[11px] text-muted">/</span>
            <span className="font-mono text-sm text-foreground">
              {data.alias}
            </span>
            <TemplateStatusBadge status={data.status} />
          </div>

          <div className="flex items-center">
            <CopyButton text={data.id} />
          </div>

          <TemplateInfoGrid template={data} />

          <CurrentBuildPanel templateId={data.id} />

          <BuildHistorySection templateId={data.id} />
        </div>
      </div>

      <DeleteTemplateDialog
        template={data}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push("/templates")}
      />
    </div>
  )
}
