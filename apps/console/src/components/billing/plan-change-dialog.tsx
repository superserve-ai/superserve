"use client"

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
} from "@superserve/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useBillingContext } from "@/hooks/use-billing-context"
import { type CatalogPlan, describeSandboxSize } from "@/lib/api/billing-v2"
import { previewPlanChange } from "@/lib/api/plan-changes"
import { billingKeys } from "@/lib/api/query-keys"

export const FREE_SWITCH_WARNING =
  "All running compute will be paused, and these will be your new limits"

const effectiveDate = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  })

export function PlanChangeDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: Pick<CatalogPlan, "key" | "kind" | "name">
  onClose: () => void
  onConfirm: (
    expectedTeam: string,
    idempotencyKey: string,
    previewToken: string,
    confirmPausesRunning: boolean,
    expectedEffectiveAt?: string,
  ) => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const { cacheScope, teamKey, ready } = useBillingContext()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const preview = useQuery({
    queryKey: billingKeys.planChangePreview({
      cacheScope,
      teamKey: teamKey ?? "",
      target: target.key,
    }),
    queryFn: () => previewPlanChange(target.key, teamKey!),
    enabled: ready && teamKey !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const data =
    ready &&
    !preview.isError &&
    preview.data?.target_plan_key === target.key &&
    preview.data.target_kind === target.kind
      ? preview.data
      : undefined
  const toFree = target.kind === "free"
  const consent =
    data &&
    teamKey !== null &&
    data.preview_token &&
    data.effective_at &&
    !data.blocked &&
    (data.timing === "immediate" || data.timing === "end_of_billing_period") &&
    (!toFree || data.pauses_running)
      ? {
          expectedTeam: teamKey,
          previewToken: data.preview_token,
          confirmPausesRunning: toFree && data.pauses_running,
          expectedEffectiveAt:
            data.timing === "end_of_billing_period"
              ? data.effective_at
              : undefined,
        }
      : null
  const size = data ? describeSandboxSize(data.limits) : null
  const when = data
    ? data.timing === "immediate"
      ? "immediately"
      : `on ${effectiveDate(data.effective_at ?? "")}`
    : null

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogPopup>
        <div className="space-y-4 p-6">
          <DialogTitle>Switch to {target.name}?</DialogTitle>
          {preview.isPending ? (
            <DialogDescription>
              Checking when this change takes effect…
            </DialogDescription>
          ) : !data || !consent ? (
            <DialogDescription>
              {data?.blocked ??
                "We couldn't check this change. Close this and try again."}
            </DialogDescription>
          ) : (
            <>
              <DialogDescription>
                {toFree ? (
                  <>
                    <strong className="text-foreground">
                      {FREE_SWITCH_WARNING}
                    </strong>
                    , starting {when}.
                  </>
                ) : (
                  <>
                    Your plan changes to {data.target_display_name} {when}.
                    {data.timing === "immediate"
                      ? null
                      : " Until then you keep your current plan and limits."}
                  </>
                )}
              </DialogDescription>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border border-dashed border-border p-4 text-sm">
                <dt className="text-muted">Running at once</dt>
                <dd className="text-foreground">
                  {data.limits.max_concurrent?.toLocaleString("en-US") ??
                    "Default"}
                </dd>
                {size ? (
                  <>
                    <dt className="text-muted">Per sandbox</dt>
                    <dd className="text-foreground">{size}</dd>
                  </>
                ) : null}
                {toFree ? (
                  <>
                    <dt className="text-muted">Runtime</dt>
                    <dd className="text-foreground">
                      Allowance per 24-hour window; sandboxes pause when it runs
                      out
                    </dd>
                  </>
                ) : null}
              </dl>
              {data.timing !== "immediate" ? (
                <p className="text-sm text-muted">
                  You can undo this before it takes effect.
                </p>
              ) : null}
            </>
          )}
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              The change didn&apos;t go through. Try again.
            </p>
          ) : null}
          <DialogFooter className="p-0">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Keep current plan
            </Button>
            <Button
              variant={toFree ? "destructive" : "default"}
              disabled={!consent || submitting || preview.isFetching}
              onClick={async () => {
                if (!consent) return
                setSubmitting(true)
                setFailed(false)
                try {
                  await onConfirm(
                    consent.expectedTeam,
                    idempotencyKey,
                    consent.previewToken,
                    consent.confirmPausesRunning,
                    consent.expectedEffectiveAt,
                  )
                } catch {
                  setFailed(true)
                  void preview.refetch()
                } finally {
                  setSubmitting(false)
                }
              }}
            >
              {submitting ? "Switching…" : `Switch to ${target.name}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
