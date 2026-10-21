import Link from "next/link"

import {
  ycAccount,
  ycProof,
  ycRequest,
  ycTeams,
  type YCClaim,
} from "@/lib/yc-claims"
import { journeyEnabled } from "@/lib/yc/acceptance-api"
import { ycClaimCaptureURL } from "@/lib/yc/capture-url"
import { claimRoute } from "@/lib/yc/claim-route"
import {
  financialAuthoritySchema,
  financialRevocationMessage,
  type FinancialAuthority,
} from "@/lib/yc/financial-authority"
import { FinancialRevocation } from "@/lib/yc/financial-revocation"
import { claimID } from "@/lib/yc/staff-schema"

import { bindYCClaim, prepareYCTeam } from "./actions"
import { prepareReviewTeam, useDifferentClaimAccount } from "./review-actions"
import { ReviewForm } from "./review-form"

export const dynamic = "force-dynamic"

export default async function YCClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; claim?: string }>
}) {
  const { result, claim: locator } = await searchParams
  const automated = journeyEnabled()
  const captureURL = ycClaimCaptureURL()
  const proof = await ycProof()
  const reviewClaim = claimID.safeParse(locator ?? proof?.id)
  const returnPath =
    automated && reviewClaim.success
      ? `/yc/claim?claim=${reviewClaim.data}`
      : "/yc/claim"
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
            href={`/auth/signup?offer=yc_2026&next=${encodeURIComponent(returnPath)}`}
          >
            Create an account
          </Link>
        </p>
        <p>
          <Link
            className="underline"
            href={`/auth/signin?offer=yc_2026&next=${encodeURIComponent(returnPath)}`}
          >
            Sign in
          </Link>
        </p>
      </main>
    )

  let claims: (YCClaim & { financial_authority?: FinancialAuthority })[] = []
  let teams: Awaited<ReturnType<typeof ycTeams>> = []
  let error = false
  const billing = new Map<string, string>()
  const acceptanceClaims = new Set<string>()
  try {
    const response = await ycRequest<{
      claims: (YCClaim & { financial_authority?: unknown })[]
    }>("claims", { user_id: user.id })
    claims = response.claims.map((claim) =>
      Object.assign(claim, {
        financial_authority: financialAuthoritySchema
          .optional()
          .parse(claim.financial_authority),
      }),
    )
    await Promise.all(
      claims
        .filter(
          (c) =>
            c.state === "bound" &&
            c.team_id &&
            c.home_region &&
            !financialRevocationMessage(c.financial_authority),
        )
        .map(async (claim) => {
          try {
            const status = await claimRoute(
              {
                id: claim.id,
                team_id: claim.team_id!,
                home_region: claim.home_region!,
                automated: !!claim.financial_authority,
              },
              user.id,
            )
            if (automated && status.acceptance) acceptanceClaims.add(claim.id)
            billing.set(claim.id, status.state)
          } catch {
            billing.set(claim.id, "unavailable")
          }
        }),
    )
    if (
      (automated && reviewClaim.success) ||
      (proof &&
        claims.some((c) => c.id === proof.id && c.state === "confirmed"))
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
          your claim.
          {captureURL ? (
            <>
              {" "}
              Or{" "}
              <a className="underline" href={captureURL}>
                submit your YC verification
              </a>
              .
            </>
          ) : (
            <>
              {" "}
              New verification is temporarily unavailable. Please try again
              later.
            </>
          )}
        </p>
      ) : null}
      {claims.map((claim) => (
        <section className="space-y-3 rounded border p-5" key={claim.id}>
          <h2 className="font-semibold">
            {claim.evidence.companies?.map((c) => c.name).join(", ") ||
              "YC verification"}
          </h2>
          <FinancialRevocation authority={claim.financial_authority} />
          {!financialRevocationMessage(claim.financial_authority) && (
            <p>
              {claim.state === "bound"
                ? acceptanceClaims.has(claim.id)
                  ? "Your claim is approved. Review and accept your offer to begin setup. Approval alone does not activate Pro or credits."
                  : billing.get(claim.id) === "active"
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
                        : claim.state === "revoked"
                          ? "Your approval has been revoked. This offer cannot be accepted. Contact Superserve for review."
                          : claim.state === "rejected"
                            ? "Your claim was rejected. You can choose a standard plan or contact Superserve for review."
                            : "Your claim is awaiting manual review."}
            </p>
          )}
          {acceptanceClaims.has(claim.id) && claim.state === "bound" && (
            <Link className="underline" href={`/yc/accept?claim=${claim.id}`}>
              Review offer and activation status
            </Link>
          )}
          {automated && claim.state === "rejected" && (
            <Link className="underline" href="/onboarding/plan">
              Choose a standard plan
            </Link>
          )}
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
      {automated &&
        reviewClaim.success &&
        !claims.some(
          (claim) =>
            claim.id === reviewClaim.data &&
            ["bound", "rejected", "revoked"].includes(claim.state),
        ) && (
          <section className="space-y-4">
            <form
              action={useDifferentClaimAccount.bind(null, reviewClaim.data)}
            >
              <p>
                Use your matching founder email, or create and verify an account
                with your preferred email before requesting review.
              </p>
              <button className="mt-3 border border-dashed border-border px-4 py-2">
                Use a different email
              </button>
            </form>
            {!error &&
              (teams.length ? (
                <ReviewForm
                  claim={reviewClaim.data}
                  actor={user.id}
                  teams={teams}
                />
              ) : (
                <form action={prepareReviewTeam.bind(null, reviewClaim.data)}>
                  <p>
                    Finish normal account setup before requesting a review. This
                    does not select a paid plan or grant offer eligibility.
                  </p>
                  <button className="mt-3 border border-dashed border-border px-4 py-2">
                    Set up your account for review
                  </button>
                </form>
              ))}
          </section>
        )}
      <p>
        {automated
          ? "YC is available once per company. No card is required for initial activation while eligible sponsored credits remain. Your offer and access must be confirmed before use."
          : "YC is available once per company. A usable payment method is required before resource usage."}
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
