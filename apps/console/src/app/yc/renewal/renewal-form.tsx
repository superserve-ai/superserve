"use client"

import * as React from "react"

import {
  renewalInputSchema,
  renewalTermsText,
  renewalView,
  type Renewal,
  type RenewalInput,
} from "@/lib/yc/renewal-schema"
import { renewalLabels } from "@/lib/yc/renewal-view"

import { saveRenewal } from "./actions"
import { RenewalSummary } from "./renewal-summary"

export function RenewalForm({
  claim,
  initial,
}: {
  claim: string
  initial: Renewal
}) {
  const [current, setCurrent] = React.useState(initial)
  const [attempt, setAttempt] = React.useState<RenewalInput | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [blocked, setBlocked] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const sending = React.useRef(false)
  const storageKey = `yc-renewal:${initial.acceptance_id}:${initial.intended_boundary}:${initial.choice_revision}`
  async function send(input: RenewalInput) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setAttempt(input)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(input))
      const result = await saveRenewal(input)
      if (result.kind === "saved") {
        setCurrent(result.renewal)
        setBlocked(true)
        sessionStorage.removeItem(storageKey)
        setMessage(
          "Your request is saved. Check its confirmation status below before relying on a different renewal plan.",
        )
      } else if (
        result.kind === "conflict" ||
        result.kind === "forbidden" ||
        result.kind === "signin"
      ) {
        setBlocked(true)
        setMessage(
          "Your account or renewal terms changed. Refresh to review the current choices.",
        )
      } else
        setMessage(
          "The result is unknown. Retry this same request or refresh to check its status. Your last confirmed instruction remains in effect.",
        )
    } catch {
      setMessage(
        "The result is unknown. Retry this same request or refresh to check its status. Your last confirmed instruction remains in effect.",
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = renewalInputSchema.parse(JSON.parse(raw))
        if (
          parsed.claim_id === claim &&
          parsed.acceptance_id === initial.acceptance_id &&
          parsed.intended_boundary === initial.intended_boundary &&
          parsed.expected_choice_revision === initial.choice_revision
        ) {
          setAttempt(parsed)
          setMessage(
            "A previous request may still be pending. Retry that exact request or refresh to check its status.",
          )
        }
      }
    } catch {
      setBlocked(true)
      setMessage(
        "We could not recover your previous request. Refresh to check the saved renewal status before making another choice.",
      )
    }
  }, [
    storageKey,
    claim,
    initial.acceptance_id,
    initial.intended_boundary,
    initial.choice_revision,
  ])
  return (
    <div className="space-y-6">
      <RenewalSummary renewal={renewalView(current)} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (attempt || blocked || busy) return
          const choice = new FormData(event.currentTarget).get("choice")
          const option = initial.available_options.find(
            (value) => value.choice === choice && value.available,
          )
          if (!option) return
          void send({
            claim_id: claim,
            assignment_id: initial.assignment_id,
            acceptance_id: initial.acceptance_id,
            intended_boundary: initial.intended_boundary,
            expected_approval_revision: initial.approval_revision,
            expected_choice_revision: initial.choice_revision,
            request_id: crypto.randomUUID(),
            choice: option.choice,
          })
        }}
      >
        <fieldset
          disabled={busy || !!attempt || blocked}
          className="space-y-4 border border-dashed border-border p-6"
        >
          <legend>Choose your next plan</legend>
          {initial.available_options.map((option) => (
            <label key={option.choice} className="block space-y-2">
              <span className="flex gap-3">
                <input
                  type="radio"
                  required
                  name="choice"
                  value={option.choice}
                  disabled={!option.available}
                />
                {renewalLabels[option.choice]}
              </span>
              <span className="block text-sm">
                {option.available
                  ? renewalTermsText(option.terms)
                  : option.unavailable_reason === "change_pending"
                    ? "A previous change must be resolved first."
                    : option.unavailable_reason === "boundary_passed"
                      ? "This renewal boundary has passed."
                      : "This option is not currently available."}
              </span>
            </label>
          ))}
          <p>
            A requested change is pending until confirmed. Your current
            confirmed plan may renew in the meantime.
          </p>
          <button
            className="border border-dashed border-border px-4 py-2"
            disabled={
              !initial.available_options.some((option) => option.available)
            }
          >
            Request plan change
          </button>
        </fieldset>
      </form>
      {message && <output className="block">{message}</output>}
      {attempt && !blocked && (
        <button
          disabled={busy}
          className="border border-dashed border-border px-4 py-2"
          onClick={() => void send(attempt)}
        >
          {busy ? "Saving request…" : "Retry same request"}
        </button>
      )}
      <a className="block underline" href={`/yc/renewal?claim=${claim}`}>
        Refresh renewal status
      </a>
    </div>
  )
}
