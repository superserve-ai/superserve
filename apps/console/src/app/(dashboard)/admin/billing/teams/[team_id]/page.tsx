import { UsersIcon } from "@phosphor-icons/react/dist/ssr"
import {
  Alert,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"
import { notFound } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import { canWriteAdminBilling } from "@/lib/admin/permissions"
import {
  getTeamPlanBilling,
  isUuid,
  type PlanChange,
  type TeamPlanBilling,
} from "@/lib/admin/team-billing"
import { configuredRegions } from "@/lib/cells"
import { regionLabel } from "@/lib/format"
import { createServerClient } from "@/lib/supabase/server"

import { formatCents, formatDay, formatPlanFee, planLabel } from "../format"
import {
  CancelPlanChangeForm,
  SchedulePlanChangeForm,
} from "./plan-change-forms"

const CHANGE_STATE: Record<
  PlanChange["state"],
  {
    label: string
    variant: "default" | "active" | "warning" | "destructive" | "muted"
  }
> = {
  scheduled: { label: "Scheduled", variant: "default" },
  prepared: { label: "Applying", variant: "warning" },
  switched: { label: "Awaiting payment", variant: "warning" },
  completed: { label: "Completed", variant: "active" },
  canceled: { label: "Canceled", variant: "muted" },
  failed: { label: "Failed", variant: "destructive" },
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-dashed border-border px-6 py-5">
      <h2 className="mb-3 font-mono text-xs text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[180px_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function changeSummary(change: PlanChange, view: TeamPlanBilling) {
  return `${planLabel(change.target_offer, view.plan_options)} on ${formatDay(change.effective_at)}`
}

export default async function AdminBillingTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ team_id: string }>
  searchParams: Promise<{ region?: string }>
}) {
  const { team_id: teamId } = await params
  const { region = "" } = await searchParams
  if (!isUuid(teamId) || !configuredRegions().includes(region)) notFound()

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const canWrite = canWriteAdminBilling(user)

  let view: TeamPlanBilling
  try {
    view = await getTeamPlanBilling(region, teamId)
  } catch (error) {
    if (error instanceof AdminBillingRequestError) {
      if (error.kind === "not_found") notFound()
      return (
        <EmptyState
          icon={UsersIcon}
          title="Team billing is unavailable"
          description="Billing details could not be loaded. Try again shortly."
        />
      )
    }
    throw error
  }

  const contract = view.contract?.status === "ended" ? null : view.contract
  const pending = view.pending_change
  const issued = view.credits.reduce((sum, c) => sum + c.amount_cents, 0)
  const remaining = view.credits.every((c) => c.remaining_cents !== null)
    ? view.credits.reduce((sum, c) => sum + (c.remaining_cents ?? 0), 0)
    : null
  const options = [
    {
      offerKey: "free",
      label: "Pay as you go",
      description: "No fee, usage at standard rates",
    },
    ...view.plan_options.map((o) => ({
      offerKey: o.offer_key,
      label: planLabel(o.offer_key, view.plan_options),
      description: `${formatPlanFee(o.fee_cents, o.interval_months)}, ${formatCents(o.monthly_credit_cents)} credit / month${o.available ? "" : " (not offered at checkout)"}`,
    })),
  ].filter((o) => o.offerKey !== (contract?.offer_key ?? "free"))

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-dashed border-border px-6 py-3 text-sm">
        <Link
          href="/admin/billing/teams"
          className="text-muted hover:text-foreground"
        >
          Teams
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-xs">{teamId}</span>
        <Badge variant="muted">{regionLabel(region)}</Badge>
      </div>

      {view.provider_error ? (
        <Alert variant="warning" className="mx-6 mt-4">
          Stripe details (card, credit balance, invoices) are temporarily
          unavailable.
        </Alert>
      ) : null}

      <Section title="Current plan">
        <Facts
          items={[
            [
              "Plan",
              contract
                ? planLabel(contract.offer_key, view.plan_options)
                : "Pay as you go",
            ],
            [
              "Status",
              contract ? (
                <Badge
                  key="status"
                  variant={contract.status === "active" ? "active" : "warning"}
                >
                  {contract.status}
                </Badge>
              ) : (
                "—"
              ),
            ],
            [
              "Fee",
              contract
                ? formatPlanFee(
                    contract.charge_amount_cents,
                    contract.charge_interval_months,
                  )
                : "No fee",
            ],
            [
              "Monthly credit",
              contract ? formatCents(contract.entitlement_amount_cents) : "—",
            ],
            ["Started", contract ? formatDay(contract.starts_at) : "—"],
            ["Ends", contract?.ends_at ? formatDay(contract.ends_at) : "—"],
            ["Billing anniversary", formatDay(view.billing_anchor)],
            [
              "Current period",
              view.period_start
                ? `${formatDay(view.period_start)} – ${formatDay(view.period_end)}`
                : "—",
            ],
            ["Subscription", view.subscription_status ?? "None"],
          ]}
        />
      </Section>

      <Section title="Scheduled change">
        {pending ? (
          <div className="space-y-4">
            <Facts
              items={[
                ["Change", changeSummary(pending, view)],
                [
                  "State",
                  <Badge
                    key="state"
                    variant={CHANGE_STATE[pending.state].variant}
                  >
                    {CHANGE_STATE[pending.state].label}
                  </Badge>,
                ],
                ["Reason", pending.reason],
                ["Requested", formatDay(pending.requested_at)],
                ...(pending.deferrals > 0
                  ? ([
                      [
                        "Deferred",
                        `${pending.deferrals} time(s) after missing its window`,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                ...(pending.last_error
                  ? ([["Last error", pending.last_error]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
            {canWrite && pending.cancelable ? (
              <CancelPlanChangeForm
                region={region}
                teamId={teamId}
                changeId={pending.id}
              />
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">No plan change is scheduled.</p>
            {canWrite && view.subscription_id ? (
              <SchedulePlanChangeForm
                region={region}
                teamId={teamId}
                options={options}
              />
            ) : null}
            {canWrite && !view.subscription_id ? (
              <p className="text-sm text-muted">
                This team has no card on file. Paid plans start through
                checkout.
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Credits this period">
        <Facts
          items={[
            ["Issued", formatCents(issued)],
            ["Remaining", remaining === null ? "—" : formatCents(remaining)],
          ]}
        />
      </Section>

      <Section title="Card on file">
        <p className="text-sm">
          {view.card
            ? `${view.card.brand.toUpperCase()} •••• ${view.card.last4}, expires ${String(view.card.exp_month).padStart(2, "0")}/${view.card.exp_year}`
            : "No card on file"}
        </p>
      </Section>

      <Section title="Recent invoices">
        {view.invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-xs">
                    {invoice.hosted_invoice_url ? (
                      <a
                        href={invoice.hosted_invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {invoice.number || invoice.id}
                      </a>
                    ) : (
                      invoice.number || invoice.id
                    )}
                  </TableCell>
                  <TableCell>{invoice.status}</TableCell>
                  <TableCell className="text-muted">
                    {formatDay(invoice.period_start)} –{" "}
                    {formatDay(invoice.period_end)}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatCents(invoice.total_cents)}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatCents(invoice.amount_paid_cents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Plan change history">
        {view.changes.length === 0 ? (
          <p className="text-sm text-muted">No plan changes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Change</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.changes.map((change) => (
                <TableRow key={change.id}>
                  <TableCell>{changeSummary(change, view)}</TableCell>
                  <TableCell>
                    <Badge variant={CHANGE_STATE[change.state].variant}>
                      {CHANGE_STATE[change.state].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted">
                    {formatDay(change.requested_at)}
                  </TableCell>
                  <TableCell className="text-muted">
                    {change.state === "canceled" && change.cancel_reason
                      ? `${change.reason} (canceled: ${change.cancel_reason})`
                      : change.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
