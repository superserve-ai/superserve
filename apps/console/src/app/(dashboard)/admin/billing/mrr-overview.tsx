import { Alert } from "@superserve/ui"

import type { AdminBillingErrorKind } from "@/lib/admin/billing-api"
import {
  type CombinedMRR,
  formatUSD,
  mrrShare,
  type RegionFailure,
} from "@/lib/admin/billing-mrr"

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
})
const count = new Intl.NumberFormat("en-US")

const FAILURE_REASON: Record<AdminBillingErrorKind, string> = {
  unavailable: "unreachable or misconfigured",
  forbidden: "billing access refused",
  read_only_impersonation: "read-only while impersonating a team",
  not_found: "endpoint not found",
  conflict: "request conflict",
  invalid: "request rejected",
}

function describeFailures(failures: RegionFailure[]): string {
  return failures
    .map(({ region, kind }) => `${region} (${FAILURE_REASON[kind]})`)
    .join(", ")
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-dashed border-border p-4">
      <p className="font-mono text-xs text-muted uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function MRROverviewView({ mrr }: { mrr: CombinedMRR }) {
  if (mrr.regions.length === 0) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          Recurring revenue is unavailable: {describeFailures(mrr.failures)}.
        </Alert>
      </div>
    )
  }
  const withCents = mrr.plans.some((plan) => plan.mrr_cents % 100 !== 0)
  return (
    <div className="space-y-6 p-6">
      {mrr.failures.length > 0 && (
        <Alert variant="warning">
          Totals are incomplete. Missing: {describeFailures(mrr.failures)}.
        </Alert>
      )}

      <section aria-labelledby="mrr-total">
        <h2 id="mrr-total" className="font-mono text-xs text-muted uppercase">
          Monthly recurring revenue
        </h2>
        <p className="mt-1 text-5xl font-semibold tracking-tight text-foreground">
          {formatUSD(mrr.mrrCents)}
        </p>
        <p className="mt-2 text-xs text-muted">
          Contracted plan fees normalised to a month, from contract terms. YC
          and sponsored annual Pro count at the Pro annual list price. Usage is
          excluded.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Annualised" value={formatUSD(mrr.mrrCents * 12)} />
        <StatTile
          label="Teams counted in MRR"
          value={count.format(mrr.revenueTeams)}
        />
        <StatTile label="All teams" value={count.format(mrr.teams)} />
      </div>

      <section aria-labelledby="mrr-by-plan">
        <h2
          id="mrr-by-plan"
          className="mb-2 font-mono text-xs text-muted uppercase"
        >
          By plan
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dashed border-border text-left font-mono text-xs text-muted uppercase">
              <th className="py-2 pr-4 font-normal">Plan</th>
              <th className="py-2 pr-4 text-right font-normal">Teams</th>
              <th className="py-2 pr-4 text-right font-normal">MRR</th>
              <th className="w-1/3 py-2 font-normal">Share of MRR</th>
            </tr>
          </thead>
          <tbody>
            {mrr.plans.map((plan) => {
              const share = mrrShare(plan.mrr_cents, mrr.mrrCents)
              return (
                <tr
                  key={plan.key}
                  className="border-b border-dashed border-border"
                >
                  <td className="py-2.5 pr-4 text-foreground">{plan.name}</td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {count.format(plan.teams)}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {formatUSD(plan.mrr_cents, withCents)}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-1.5 flex-1 overflow-hidden bg-foreground/10"
                        aria-hidden
                      >
                        <div
                          className="h-full bg-foreground/70"
                          style={{ width: `${share * 100}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs text-muted tabular-nums">
                        {percent.format(share)}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
