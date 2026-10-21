import { renewalLabels, type RenewalView } from "@/lib/yc/renewal-view"

export function RenewalSummary({ renewal }: { renewal: RenewalView }) {
  return (
    <section
      className="space-y-4 border border-dashed border-border p-6"
      aria-label="Renewal status"
    >
      <h1 className="text-2xl font-semibold">Your next plan</h1>
      {renewal.confirmed ? (
        <div>
          <h2 className="font-semibold">
            Confirmed: {renewalLabels[renewal.confirmed.choice]}
          </h2>
          <p>{renewal.confirmed.terms}</p>
          <p>Takes effect: {renewal.confirmed.boundary}</p>
        </div>
      ) : (
        <p>
          Your renewal instruction has not been confirmed. Refresh or contact
          Superserve before relying on a plan change.
        </p>
      )}
      {renewal.requested && (
        <div>
          <h2 className="font-semibold">
            Requested: {renewalLabels[renewal.requested.choice]}
          </h2>
          <p>{renewal.requested.terms}</p>
          <p>Requested effective date: {renewal.requested.boundary}</p>
          <p>Status: {renewal.requested.state.replaceAll("_", " ")}</p>
          {renewal.requested.state !== "confirmed" && (
            <p>
              Your change is not confirmed. The last confirmed instruction
              remains in effect and may renew while this request is pending.
            </p>
          )}
        </div>
      )}
      {renewal.successor === "active" && (
        <p>Your paid renewal plan is active.</p>
      )}
      {renewal.successor === "free" && <p>Your Free plan is now in effect.</p>}
      {renewal.successor === "payment_pending" && (
        <p>
          Your paid plan is waiting for verified payment and account
          eligibility. Paid benefits are not active yet.
        </p>
      )}
      {renewal.successor === "review_required" && (
        <p>Your next plan needs review. Contact Superserve.</p>
      )}
      <p>A plan change does not clear existing usage or unpaid charges.</p>
    </section>
  )
}
