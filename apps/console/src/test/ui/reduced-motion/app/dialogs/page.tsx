"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { RevokeKeyDialog } from "@/components/api-keys/revoke-key-dialog"
import { DeleteSandboxDialog } from "@/components/sandboxes/delete-sandbox-dialog"
import { DeleteSnapshotDialog } from "@/components/snapshots/delete-snapshot-dialog"

import { FixtureShell } from "../fixture-shell"

const KINDS = ["sandbox", "snapshot", "key"] as const
type Kind = (typeof KINDS)[number]

const SNAPSHOT = {
  id: "snap-3c91d2e0aa",
  sandbox_id: "sbx-7f3a91c2",
  template_id: null,
  kind: "mem+fs" as const,
  status: "ready" as const,
  name: "baseline",
  size_bytes: 1048576,
  resources: { vcpu_count: 2, memory_mib: 2048, disk_mib: 4096 },
  created_at: "2026-11-01T09:30:00Z",
  ready_at: "2026-11-01T09:31:00Z",
}

const never = () => new Promise<void>(() => {})

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

// Types the confirmation text and presses the confirm button, so the dialog
// sits in its pending state: the request behind it never answers.
function useAutoConfirm(kind: Kind, label: string) {
  useEffect(() => {
    const timer = setInterval(() => {
      const popup = document.querySelector('[role="dialog"]')
      const input = popup?.querySelector("input")
      if (!popup || !input) return
      if (input.value !== label) setInputValue(input, label)
      const confirm = [...popup.querySelectorAll("button")].find(
        (b) => /^(Delete|Revoke)$/.test(b.textContent ?? "") && !b.disabled,
      )
      if (!confirm) return
      confirm.click()
      clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [kind, label])
}

const LABELS: Record<Kind, string> = {
  sandbox: "agent-runner",
  snapshot: "baseline",
  key: "ci-key",
}

function Dialogs({ kind }: { kind: Kind }) {
  useAutoConfirm(kind, LABELS[kind])
  const noop = () => {}
  return (
    <>
      {kind === "sandbox" ? (
        <DeleteSandboxDialog
          open
          onOpenChange={noop}
          onConfirm={never}
          sandboxName={LABELS.sandbox}
        />
      ) : null}
      {kind === "snapshot" ? (
        <DeleteSnapshotDialog snapshot={SNAPSHOT} open onOpenChange={noop} />
      ) : null}
      {kind === "key" ? (
        <RevokeKeyDialog
          open
          onOpenChange={noop}
          onConfirm={never}
          keyName={LABELS.key}
        />
      ) : null}
    </>
  )
}

export default function Page() {
  const [kind, setKind] = useState<Kind>("sandbox")
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d")
    if (KINDS.includes(d as Kind)) setKind(d as Kind)
  }, [])
  return (
    <FixtureShell>
      <div className="flex items-center gap-4 p-4 text-xs text-muted">
        <span>Pending confirm button in:</span>
        {KINDS.map((k) => (
          <Link
            key={k}
            href={`/dialogs/?d=${k}`}
            className={k === kind ? "text-foreground" : "hover:text-foreground"}
            onClick={() => setTimeout(() => window.location.reload())}
          >
            {k}
          </Link>
        ))}
      </div>
      <Dialogs key={kind} kind={kind} />
    </FixtureShell>
  )
}
