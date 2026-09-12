"use client"

import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  SignInIcon,
} from "@phosphor-icons/react"
import { Button, buttonVariants, Spinner } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"

import { useQmAdminLink } from "@/hooks/use-qm-tenants"
import type { QmAdminLink } from "@/lib/api/types"
import { QM_EVENTS } from "@/lib/posthog/events"

interface AdminLinkPanelProps {
  tenantId: string
  adminEmail: string
}

function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000))
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * Mints and reveals a one-time admin sign-in link. The link is a credential:
 * it exists only in this component's state, is never written to the query
 * cache, storage, or analytics, and disappears when it expires or the panel
 * unmounts. Minting again replaces it.
 */
export function AdminLinkPanel({ tenantId, adminEmail }: AdminLinkPanelProps) {
  const posthog = usePostHog()
  const { mint, isPending } = useQmAdminLink(tenantId)
  const [link, setLink] = useState<QmAdminLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const remaining = link ? secondsUntil(link.expiresAt, now) : 0
  const expired = link !== null && remaining === 0

  useEffect(() => {
    if (!link) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [link])

  // Drop the credential the moment it is no longer valid.
  useEffect(() => {
    if (expired) setLink(null)
  }, [expired])

  const handleMint = async () => {
    setCopied(false)
    try {
      const minted = await mint()
      posthog.capture(QM_EVENTS.ADMIN_LINK_MINTED, { tenant_id: tenantId })
      setLink(minted)
    } catch {
      // The hook already toasted the failure.
    }
  }

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the link is still visible to select by hand.
    }
  }

  return (
    <section className="border-b border-border">
      <div className="flex h-10 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-foreground">Admin sign-in</h2>
        {link && (
          <span
            className="font-mono text-xs text-warning uppercase tabular-nums"
            aria-live="polite"
          >
            Expires in {formatCountdown(remaining)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4">
        {link ? (
          <>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate border border-dashed border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
                title={link.url}
                data-testid="admin-link-url"
              >
                {link.url}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy sign-in link"}
              >
                {copied ? (
                  <CheckIcon className="size-3.5 text-brand" weight="bold" />
                ) : (
                  <CopyIcon className="size-3.5" weight="light" />
                )}
              </Button>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: "sm" })}
              >
                <ArrowSquareOutIcon className="size-3.5" weight="light" />
                Open
              </a>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Single-use. Opening it signs you in as{" "}
              <span className="text-foreground/80">{adminEmail}</span>. It
              isn&apos;t stored anywhere — once it expires or you leave this
              page, generate a new one.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted">
              Generate a one-time link that signs you in to the stack as{" "}
              <span className="text-foreground/80">{adminEmail}</span> without
              waiting for an email. Links last a few minutes and work once.
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMint}
                disabled={isPending}
              >
                {isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <SignInIcon className="size-3.5" weight="light" />
                )}
                Open admin sign-in
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
