"use client"

import * as React from "react"

import { submitIdentityReview } from "./review-actions"

export function ReviewForm({
  claim,
  actor,
  teams,
}: {
  claim: string
  actor: string
  teams: Array<{ teamId: string; region: string; name: string }>
}) {
  const [pending, setPending] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const attempt = React.useRef<{
    claim_id: string
    team: string
    request_id: string
    verification_link: string
  } | null>(null)
  const sending = React.useRef(false)
  async function send(input: NonNullable<typeof attempt.current>) {
    if (sending.current) return
    sending.current = true
    setPending(true)
    try {
      const result = await submitIdentityReview(input)
      if (result.kind === "saved") {
        setSaved(true)
        attempt.current = null
        setMessage(
          "Your review request is saved. This does not approve the offer. We will email your verified account when a decision is made; you can also return here to check.",
        )
      } else
        setMessage(
          "We could not confirm your review request. Retry the same request or refresh to check its status.",
        )
    } catch {
      setMessage(
        "We could not confirm your review request. Retry the same request or refresh to check its status.",
      )
    } finally {
      sending.current = false
      setPending(false)
    }
  }
  return (
    <section
      className="space-y-4 border border-dashed border-border p-5"
      data-mask
    >
      <h2 className="font-semibold">Request review for this account</h2>
      <p>
        Use your original YC verification link. Staff will review your YC
        identity alongside this verified account and team. Approval still
        requires you to accept the offer.
      </p>
      {!saved && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            if (!attempt.current) {
              const team = String(form.get("team"))
              const key = `yc-review:${actor}:${claim}:${team}`
              try {
                const id = sessionStorage.getItem(key) ?? crypto.randomUUID()
                sessionStorage.setItem(key, id)
                attempt.current = {
                  claim_id: claim,
                  team,
                  request_id: id,
                  verification_link: String(form.get("verification_link")),
                }
              } catch {
                setMessage(
                  "We could not retain your review request. Please retry with browser storage available.",
                )
                return
              }
            }
            void send(attempt.current)
          }}
          className="space-y-3"
        >
          <label className="block">
            Original YC verification link
            <input
              type="url"
              name="verification_link"
              required
              autoComplete="off"
              maxLength={2048}
              readOnly={!!attempt.current}
              className="block w-full border border-dashed p-2"
            />
          </label>
          <label className="block">
            Team
            <select
              name="team"
              required
              disabled={!!attempt.current}
              className="block w-full border border-dashed p-2"
            >
              <option value="">Choose your team</option>
              {teams.map((team) => (
                <option
                  key={`${team.region}:${team.teamId}`}
                  value={`${team.region}:${team.teamId}`}
                >
                  {team.name} ({team.region})
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={pending}
            className="border border-dashed border-border px-4 py-2"
          >
            {pending
              ? "Saving request…"
              : attempt.current
                ? "Retry same review request"
                : "Request review"}
          </button>
        </form>
      )}
      {message && <output className="block">{message}</output>}
    </section>
  )
}
