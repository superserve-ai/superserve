import Link from "next/link"

import { configuredRegions } from "@/lib/cells"
import { financialRevocationMessage } from "@/lib/yc/financial-authority"
import { FinancialRevocation } from "@/lib/yc/financial-revocation"
import { getStaffClaim, listStaffClaims } from "@/lib/yc/staff-api"
import { claimState, type StaffClaim } from "@/lib/yc/staff-schema"

import { DecisionForm } from "./decision-form"
import { staffGoogleLogin, staffSignOut } from "./staff-login"
import { staffLoginSession, staffReviewPath } from "./staff-login-session"

export const dynamic = "force-dynamic"
export default async function StaffYCPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string; state?: string; after?: string }>
}) {
  const params = await searchParams
  let claims: StaffClaim[]
  try {
    claims = params.claim
      ? [await getStaffClaim(params.claim)]
      : await listStaffClaims(params.state, params.after)
  } catch {
    const enabled = process.env.YC_STAFF_UI_ENABLED === "true"
    const session = enabled ? await staffLoginSession() : null
    return (
      <main className="space-y-4 p-8">
        <h1 className="text-2xl">YC claim review</h1>
        <p role="alert">
          Claim review is unavailable. Sign in with your authorized staff Google
          account, or retry later.
        </p>
        {session?.kind === "signin" && (
          <Link
            className="underline"
            href={`/auth/signin?next=${encodeURIComponent(staffReviewPath(params.claim))}`}
          >
            Sign in with your staff Google account
          </Link>
        )}
        {session?.kind === "nonstaff" && (
          <form action={staffSignOut.bind(null, params.claim)}>
            <p>This account cannot access staff review.</p>
            <button className="border border-dashed border-border px-4 py-2">
              Sign out and use your staff account
            </button>
          </form>
        )}
        {session?.kind === "impersonating" && (
          <p>Stop impersonating before verifying your staff Google sign-in.</p>
        )}
        {session?.kind === "eligible" && (
          <form action={staffGoogleLogin.bind(null, params.claim)}>
            <button className="border border-dashed border-border px-4 py-2">
              Verify staff Google sign-in
            </button>
          </form>
        )}
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl">YC claim review</h1>
      <nav className="flex flex-wrap gap-4" aria-label="Claim filters">
        {claimState.options.map((state) => (
          <Link
            className="underline"
            href={`/admin/yc?state=${state}`}
            key={state}
          >
            {state.replaceAll("_", " ")}
          </Link>
        ))}
      </nav>
      {!claims.length && <p>No claims in this view.</p>}
      {claims.map((claim) => (
        <section
          key={`${claim.id}:${claim.revision}`}
          className="space-y-4 border border-dashed border-border p-5"
          data-mask
        >
          <h2 className="text-lg">
            <Link className="underline" href={`/admin/yc?claim=${claim.id}`}>
              {claim.submitted_email}
            </Link>
          </h2>
          <p>{claim.company_identity ?? "Company match needs review"}</p>
          {claim.preferred_identity_review && (
            <div className="grid gap-4 border border-dashed border-border p-4 sm:grid-cols-2">
              <section>
                <h3 className="font-semibold">Original YC identity</h3>
                <p>{claim.submitted_email}</p>
                <p>Founder: {claim.founder_email ?? "Unavailable"}</p>
              </section>
              <section>
                <h3 className="font-semibold">Requested verified account</h3>
                <p>{claim.preferred_identity_review.email}</p>
                <p>Team: {claim.preferred_identity_review.team_id}</p>
                <p>Region: {claim.preferred_identity_review.home_region}</p>
                <p>
                  Review revision:{" "}
                  {claim.preferred_identity_review.review_revision}
                </p>
              </section>
            </div>
          )}
          <FinancialRevocation authority={claim.financial_authority} />
          {!financialRevocationMessage(claim.financial_authority) && (
            <p>
              {claim.state === "bound"
                ? "Approved. Customer acceptance and activation must be checked separately."
                : claim.state.replaceAll("_", " ")}
            </p>
          )}
          <p>{claim.reason}</p>
          {claim.approval_notification && (
            <p>
              Approval email:{" "}
              {claim.approval_notification.status.replaceAll("_", " ")}.{" "}
              {claim.approval_notification.status === "sent" &&
                "Accepted by the email provider; inbox delivery is not confirmed."}
            </p>
          )}
          {params.claim && (
            <>
              <ol>
                {claim.decisions?.map((decision) => (
                  <li key={decision.revision}>
                    {decision.decision}: {decision.reason}{" "}
                    {decision.evidence_reference}
                  </li>
                ))}
              </ol>
              <DecisionForm claim={claim} regions={configuredRegions()} />
            </>
          )}
        </section>
      ))}
      {!params.claim && claims.length === 100 && (
        <Link
          className="underline"
          href={`/admin/yc?state=${params.state ?? "manual_review"}&after=${claims.at(-1)!.id}`}
        >
          Next page
        </Link>
      )}
      <a
        className="underline"
        href={
          params.claim
            ? `/admin/yc?claim=${encodeURIComponent(params.claim)}`
            : `/admin/yc?state=${encodeURIComponent(params.state ?? "manual_review")}`
        }
      >
        Refresh status
      </a>
    </main>
  )
}
