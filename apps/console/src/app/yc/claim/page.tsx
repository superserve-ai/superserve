import Link from "next/link"

import {
  ycAccount,
  ycProof,
  ycRequest,
  ycTeams,
  type YCClaim,
} from "@/lib/yc-claims"

import { bindYCClaim, prepareYCTeam } from "./actions"

export const dynamic = "force-dynamic"

export default async function YCClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>
}) {
  const { result } = await searchParams
  let user
  try {
    user = await ycAccount()
  } catch {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Complete your YC claim</h1>
        <p role="alert">
          Use your own account with a verified email address to complete this
          claim. Contact Superserve if you need help.
        </p>
      </main>
    )
  }
  const shell = "mx-auto max-w-2xl space-y-6 p-8"
  if (!user)
    return (
      <main className={shell}>
        <h1 className="text-2xl font-semibold">Complete your YC claim</h1>
        <p>
          After confirming your email, create an account or sign in using that
          same address.
        </p>
        <p>
          <Link
            className="underline"
            href="/auth/signup?offer=yc_2026&next=%2Fyc%2Fclaim"
          >
            Create an account
          </Link>
        </p>
        <p>
          <Link
            className="underline"
            href="/auth/signin?offer=yc_2026&next=%2Fyc%2Fclaim"
          >
            Sign in
          </Link>
        </p>
      </main>
    )

  let claims: YCClaim[] = []
  let teams: Awaited<ReturnType<typeof ycTeams>> = []
  let error = false
  const billing = new Map<string, string>()
  const proof = await ycProof()
  try {
    claims = (
      await ycRequest<{ claims: YCClaim[] }>("claims", { user_id: user.id })
    ).claims
    await Promise.all(
      claims
        .filter((c) => c.state === "bound" && c.team_id && c.home_region)
        .map(async (claim) => {
          try {
            const status = await ycRequest<{ state: string }>(
              "status",
              { id: claim.id, user_id: user.id, team_id: claim.team_id },
              claim.home_region!,
            )
            billing.set(claim.id, status.state)
          } catch {
            billing.set(claim.id, "unavailable")
          }
        }),
    )
    if (
      proof &&
      claims.some((c) => c.id === proof.id && c.state === "confirmed")
    )
      teams = await ycTeams(user)
  } catch {
    error = true
  }
  return (
    <main className={shell}>
      <h1 className="text-2xl font-semibold">Your YC claim</h1>
      <p data-mask>Signed in as {user.email}.</p>
      {error || result === "retry" ? (
        <p role="alert">
          We could not complete the request. Check that you are using the
          confirmed account and an authorized team, then retry. Contact
          Superserve if you need manual review.
        </p>
      ) : null}
      {result === "review" ? (
        <output>This claim requires manual review before activation.</output>
      ) : null}
      {!error && !claims.length ? (
        <p>
          No claim was found for this verified account email. Use the email from
          your claim, or{" "}
          <a className="underline" href="https://www.superserve.ai/yc">
            submit your YC verification
          </a>
          .
        </p>
      ) : null}
      {claims.map((claim) => (
        <section className="space-y-3 rounded border p-5" key={claim.id}>
          <h2 className="font-semibold">
            {claim.evidence.companies?.map((c) => c.name).join(", ") ||
              "YC verification"}
          </h2>
          <p>
            {claim.state === "bound"
              ? billing.get(claim.id) === "active"
                ? "Your YC Pro access is active and the payment-method requirement is satisfied."
                : billing.get(claim.id) === "awaiting_payment_method"
                  ? "Your YC activation is approved. Add or update a usable payment method in team billing before using resources."
                  : billing.get(claim.id) === "requires_review"
                    ? "Your team is attached, but billing activation requires Superserve review."
                    : billing.get(claim.id) === "renewed"
                      ? "Your YC offer has transitioned to its renewal plan. View team billing for current plan details."
                      : billing.get(claim.id) === "unavailable"
                        ? "Your team is attached. Billing status is temporarily unavailable; refresh to check activation."
                        : "Eligibility approved and team attached. Billing activation is pending; Pro access and credits are not enabled by this claim."
              : claim.confirmation_status === "expired"
                ? "Your confirmation link has expired. Contact Superserve for manual review."
                : claim.confirmation_status === "delivery_failed"
                  ? "Your claim is saved, but confirmation email delivery failed. Contact Superserve to retry delivery."
                  : claim.state === "confirmed"
                    ? "Email confirmed. Choose the team that should receive your company's offer."
                    : claim.state === "awaiting_confirmation"
                      ? "Email confirmation is pending. Open the link sent to your founder email."
                      : claim.state === "revoked" || claim.state === "rejected"
                        ? "This claim is not approved. Contact Superserve for review."
                        : "Your claim is awaiting manual review."}
          </p>
          {proof?.id === claim.id &&
          claim.state === "confirmed" &&
          claim.confirmation_status !== "expired" &&
          teams.length ? (
            <form action={bindYCClaim} className="space-y-3">
              <label className="block">
                Team (owner or administrator required)
                <select
                  name="team"
                  required
                  defaultValue=""
                  className="mt-2 block w-full rounded border p-2"
                >
                  <option value="" disabled>
                    Select your team
                  </option>
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
              <button className="rounded border px-4 py-2" type="submit">
                Attach claim to this team
              </button>
            </form>
          ) : null}
          {!error &&
          proof?.id === claim.id &&
          claim.state === "confirmed" &&
          claim.confirmation_status !== "expired" &&
          !teams.length ? (
            <form action={prepareYCTeam}>
              <p>
                Finish normal account setup to create your first team, then
                choose it for your claim.
              </p>
              <button className="mt-3 rounded border px-4 py-2" type="submit">
                Finish account setup
              </button>
            </form>
          ) : null}
          {claim.state === "confirmed" && proof?.id !== claim.id ? (
            <p>
              Reopen your confirmation email in this browser to finish attaching
              the claim.
            </p>
          ) : null}
        </section>
      ))}
      <p>
        YC is available once per company. A usable payment method is required
        before resource usage.
      </p>
      <p>
        <Link href="/sandboxes" className="underline">
          Return to console
        </Link>{" "}
        ·{" "}
        <Link href="/yc/claim" className="underline">
          Refresh status
        </Link>
      </p>
    </main>
  )
}
