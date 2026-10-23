import { Alert } from "@superserve/ui"

import { type CombinedMRR, formatUSD, mrrShare } from "@/lib/admin/billing-mrr"
import { formatDate } from "@/lib/format"

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
})
const count = new Intl.NumberFormat("en-US")

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-dashed border-border p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function MRROverviewView({ mrr }: { mrr: CombinedMRR }) {
  if (mrr.regions.length === 0) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          Recurring revenue is unavailable. Retry in a moment.
        </Alert>
      </div>
    )
  }
  return (
    <div className="space-y-6 p-6">
      {mrr.unavailableRegions.length > 0 && (
        <Alert variant="warning">
          Excludes {mrr.unavailableRegions.join(", ")}: that region did not
          respond, so totals are incomplete.
        </Alert>
      )}

      <section aria-labelledby="mrr-total">
        <p id="mrr-total" className="text-xs text-muted">
          Monthly recurring revenue
        </p>
        <p className="mt-1 text-5xl font-semibold tracking-tight text-foreground">
          {formatUSD(mrr.mrrCents)}
        </p>
        <p className="mt-2 text-xs text-muted">
          Contracted plan fees normalised to a month, from contract terms. YC
          and sponsored annual Pro count at the Pro annual list price. Usage is
          excluded.
          {mrr.asOf && ` As of ${formatDate(new Date(mrr.asOf))}.`}
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
                  className="border-b border-dashed border-border hover:bg-surface-hover"
                >
                  <td className="py-2.5 pr-4 text-foreground">{plan.name}</td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {count.format(plan.teams)}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                    {formatUSD(plan.mrr_cents)}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 bg-brand/15" aria-hidden>
                        <div
                          className="h-full bg-brand"
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
