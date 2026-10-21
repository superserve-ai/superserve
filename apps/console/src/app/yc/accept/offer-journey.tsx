"use client"

import Link from "next/link"
import * as React from "react"

import {
  acceptanceState,
  offerTermsView,
  type Acceptance,
  type AcceptInput,
} from "@/lib/yc/acceptance-schema"
import type { JourneyState } from "@/lib/yc/journey-state"
import { money } from "@/lib/yc/offer-view"

import {
  openOfferBilling,
  openReadyOfferConsole,
  refreshAcceptance,
  submitAcceptance,
} from "./actions"
import { OfferTerms } from "./offer-terms"
import { StatusPanel } from "./status-panel"

export function OfferJourney({ initial }: { initial: Acceptance }) {
  const [offer, setOffer] = React.useState(initial)
  const [claimState, setClaimState] = React.useState<JourneyState | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const [attempt, setAttempt] = React.useState<AcceptInput | null>(null)
  const sending = React.useRef(false)
  const authorityState = claimState ?? acceptanceState(offer)
  const state = failure ? "unavailable" : authorityState
  React.useEffect(() => {
    if (claimState && claimState !== "financial_revocation_pending") return
    if (authorityState === "financial_revoked") return
    if (
      authorityState !== "financial_revocation_pending" &&
      (offer.state === "offered" || offer.state === "revoked")
    )
      return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await refreshAcceptance(initial.claim_id)
        if (cancelled) return
        if (result.kind === "claim_state") {
          setClaimState(result.state)
          setFailure(false)
          if (result.state !== "financial_revocation_pending") return
        } else if (
          result.kind === "saved" &&
          result.offer.acceptance_id === initial.acceptance_id &&
          result.offer.terms_digest === initial.terms_digest &&
          result.offer.renewal_terms_digest === initial.renewal_terms_digest
        ) {
          setOffer(result.offer)
          setClaimState(null)
          setFailure(false)
        } else setFailure(true)
      } catch {
        if (!cancelled) setFailure(true)
      }
      if (!cancelled) timer = setTimeout(poll, 15000)
    }
    timer = setTimeout(poll, 10000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    initial.claim_id,
    initial.acceptance_id,
    initial.terms_digest,
    initial.renewal_terms_digest,
    offer.state,
    claimState,
    authorityState,
  ])

  async function accept() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      const storageKey = `yc-acceptance:${initial.user_id}:${initial.acceptance_id}:${initial.terms_digest}:${initial.renewal_terms_digest}`
      const request =
        initial.request_id ??
        sessionStorage.getItem(storageKey) ??
        crypto.randomUUID()
      sessionStorage.setItem(storageKey, request)
      const input = attempt ?? {
        claim_id: initial.claim_id,
        acceptance_id: initial.acceptance_id,
        request_id: request,
        approval_revision: initial.approval_revision,
        terms_digest: initial.terms_digest,
        renewal_terms_digest: initial.renewal_terms_digest,
      }
      setAttempt(input)
      const result = await submitAcceptance(input)
      if (result.kind === "claim_state") {
        setClaimState(result.state)
        setFailure(false)
      } else if (result.kind === "saved") {
        setOffer(result.offer)
        setFailure(false)
        setMessage("")
      } else if (
        result.kind === "conflict" ||
        result.kind === "forbidden" ||
        result.kind === "signin"
      ) {
        setFailure(true)
        setMessage(
          "Your account or offer changed. Refresh and review the current offer before continuing.",
        )
      } else
        setMessage(
          "We could not confirm your acceptance. Retry the same acceptance or refresh to check its saved status.",
        )
    } catch {
      setMessage(
        "We could not confirm your acceptance. Keep this page open and retry, or refresh to check the saved status.",
      )
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <div className="space-y-6">
      <StatusPanel
        state={state}
        readyAction={openReadyOfferConsole.bind(null, offer.claim_id)}
      />
      {offer.control_pending && (
        <output className="block">
          Your hold or revocation is saved while an earlier setup result is
          checked. This does not permit new activation, and does not confirm
          cancellation or a refund.
        </output>
      )}
      <OfferTerms terms={offerTermsView(offer)} />
      <details className="border border-dashed border-border p-6">
        <summary className="cursor-pointer underline">
          Approved renewal credits and resource rates
        </summary>
        <p className="mt-3">
          Monthly allowances for the {offer.renewal_terms.term_months}-month
          renewal term:
        </p>
        <ol className="list-inside list-decimal">
          {offer.renewal_terms.monthly_allowance_cents.map((amount, index) => (
            <li key={index}>
              Month {index + 1}: {money(amount, offer.renewal_terms.currency)}
            </li>
          ))}
        </ol>
        <p>No rollover. No proration.</p>
        <dl>
          {offer.renewal_terms.resource_rates.map((rate) => (
            <div key={rate.id}>
              <dt>{rate.resource}</dt>
              <dd>
                {rate.price_usd} {rate.currency} per {rate.unit}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      {state === "acceptance_required" && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void accept()
          }}
          className="space-y-4"
        >
          <label className="flex gap-3">
            <input
              type="checkbox"
              required
              disabled={busy || !!attempt}
              defaultChecked={!!attempt}
            />
            I accept the offer, monthly credit expiry, usage charges, and
            renewal terms shown above.
          </label>
          <button
            disabled={busy}
            type="submit"
            className="border border-dashed border-brand px-5 py-3 font-mono text-xs uppercase"
          >
            {busy
              ? "Saving acceptance…"
              : attempt
                ? "Retry same acceptance"
                : "Accept offer"}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
      {!claimState &&
        ![
          "financial_revocation_pending",
          "financial_revoked",
          "unavailable",
        ].includes(state) &&
        offer.accepted_at && (
          <Link
            className="block underline"
            href={`/yc/renewal?claim=${offer.claim_id}`}
          >
            Review your next plan
          </Link>
        )}
      {(state === "payment_needed" || state === "exhausted") && (
        <form action={openOfferBilling.bind(null, offer.claim_id)}>
          <button className="underline">Open team billing</button>
        </form>
      )}
      <a
        className="block underline"
        href={`/yc/accept?claim=${offer.claim_id}`}
      >
        Refresh status
      </a>
    </div>
  )
}
