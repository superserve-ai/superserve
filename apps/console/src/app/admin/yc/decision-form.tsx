"use client"

import * as React from "react"

import { financialRevocationMessage } from "@/lib/yc/financial-authority"
import {
  staffDecisionSchema,
  type StaffClaim,
  type StaffDecision,
} from "@/lib/yc/staff-schema"

import { submitStaffDecision } from "./actions"

export function DecisionForm({
  claim,
  regions,
}: {
  claim: StaffClaim
  regions: string[]
}) {
  const preferred = claim.preferred_identity_review
  const [pending, setPending] = React.useState(false)
  const [attempt, setAttempt] = React.useState<{
    decision: StaffDecision
    region: string
  } | null>(null)
  const [message, setMessage] = React.useState("")
  const [saved, setSaved] = React.useState(false)
  const [conflict, setConflict] = React.useState(false)
  async function send(value: NonNullable<typeof attempt>) {
    setPending(true)
    try {
      const result = await submitStaffDecision(value.decision, value.region)
      if (result.kind === "saved") {
        setSaved(true)
        const financial = financialRevocationMessage(
          result.claim.financial_authority,
        )
        setMessage(
          financial
            ? `${financial.title}. ${financial.description} Refresh to check the latest status.`
            : "Decision saved. Approval still requires the customer to accept the offer. Refresh to view the latest claim and email status.",
        )
      } else if (result.kind === "conflict" || result.kind === "forbidden") {
        setConflict(true)
        setMessage(
          "The claim or your permissions changed. Refresh before taking another action.",
        )
      } else
        setMessage(
          "The result could not be confirmed. Retry this same decision or refresh to check its status before making a new decision.",
        )
    } catch {
      setMessage(
        "The result could not be confirmed. Retry this same decision or refresh to check its status before making a new decision.",
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (pending || attempt) return
          const form = new FormData(event.currentTarget)
          const decision = form.get("decision")
          const parsed = staffDecisionSchema.safeParse({
            id: claim.id,
            expected_revision: claim.revision,
            request_id: crypto.randomUUID(),
            decision,
            reason: form.get("reason"),
            evidence_reference: form.get("evidence_reference"),
            ...(decision === "approve"
              ? preferred
                ? {
                    user_id: preferred.user_id,
                    team_id: preferred.team_id,
                    review_request_id: preferred.review_request_id,
                    review_revision: preferred.review_revision,
                  }
                : {
                    user_id: form.get("user_id"),
                    team_id: form.get("team_id"),
                    ...(form.get("company_identity")
                      ? { company_identity: form.get("company_identity") }
                      : {}),
                  }
              : {}),
          })
          if (!parsed.success) {
            setMessage(
              "Enter a reason, evidence reference, and a valid account and team for approval.",
            )
            return
          }
          const value = {
            decision: parsed.data,
            region: preferred?.home_region ?? String(form.get("region")),
          }
          setAttempt(value)
          void send(value)
        }}
      >
        <fieldset
          disabled={!!attempt || pending}
          className="grid gap-4 border border-dashed border-border p-5"
        >
          <legend>Review decision</legend>
          <label>
            Decision
            <select
              name="decision"
              className="block w-full border border-dashed p-2"
            >
              <option value="approve">Approve for offer acceptance</option>
              <option value="reject">Reject</option>
              <option value="revoke">Revoke approval</option>
              <option value="retry-approval-email">Retry approval email</option>
            </select>
          </label>
          <label>
            Account ID for approval
            <input
              name="user_id"
              readOnly={!!preferred}
              defaultValue={preferred?.user_id ?? claim.claimed_user_id ?? ""}
              className="block w-full border border-dashed p-2"
            />
          </label>
          <label>
            Team ID for approval
            <input
              name="team_id"
              readOnly={!!preferred}
              defaultValue={preferred?.team_id ?? claim.team_id ?? ""}
              className="block w-full border border-dashed p-2"
            />
          </label>
          <label>
            Team region
            <select
              name="region"
              defaultValue={claim.home_region ?? regions[0]}
              className="block w-full border border-dashed p-2"
            >
              {regions.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          {!preferred && (
            <label>
              Company directory URL (if correcting the match)
              <input
                name="company_identity"
                className="block w-full border border-dashed p-2"
              />
            </label>
          )}
          <label>
            Reason
            <textarea
              name="reason"
              required
              maxLength={1000}
              className="block w-full border border-dashed p-2"
            />
          </label>
          <label>
            Evidence reference
            <input
              name="evidence_reference"
              required
              maxLength={1000}
              className="block w-full border border-dashed p-2"
            />
          </label>
          <p>
            Approval does not accept the offer or activate credits. The customer
            must review and accept the offer.
          </p>
          <button
            type="submit"
            className="border border-dashed border-border px-4 py-2 font-mono text-xs uppercase"
          >
            Save decision
          </button>
        </fieldset>
      </form>
      {message && <output className="block">{message}</output>}
      {attempt && !saved && !conflict && (
        <button
          disabled={pending}
          onClick={() => void send(attempt)}
          className="border border-dashed border-border px-4 py-2"
        >
          {pending ? "Saving…" : "Retry same decision"}
        </button>
      )}
    </div>
  )
}
