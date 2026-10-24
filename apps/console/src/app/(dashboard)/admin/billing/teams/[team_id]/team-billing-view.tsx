import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"

import type {
  PlanCatalog,
  StaffCredit,
  TeamPlan,
  TeamPlanAssignments,
} from "@/lib/admin/team-billing"
import { regionLabel } from "@/lib/format"

import { describeLimits, formatCents, formatDay } from "../format"
import {
  AssignPlanForm,
  type PlanChangeOption,
  PlanChangeForm,
  UndoPlanChangeForm,
} from "./plan-change-forms"
import { ResumeStaffCreditButton, StaffCreditForm } from "./staff-credit-forms"

const END_OF_PERIOD =
  "Takes effect at the end of the team's billing period, or the next one if that is less than an hour away or the subscription already renewed. Can be undone until 10 minutes before."

const DOWNGRADES: Record<string, PlanChangeOption[]> = {
  subscription: [
    { target: "starter", label: "Starter", timing: END_OF_PERIOD },
    { target: "free", label: "Free", timing: END_OF_PERIOD },
  ],
  custom: [{ target: "free", label: "Free", timing: END_OF_PERIOD }],
  prepaid: [
    {
      target: "free",
      label: "Free",
      timing: "Takes effect immediately and cannot be undone.",
    },
  ],
}

const KINDS: Record<string, string> = {
  free: "Free",
  prepaid: "Prepaid credit",
  subscription: "Subscription",
  legacy_payg: "Legacy pay as you go",
  custom: "Custom",
}

const SOURCES: Record<string, string> = {
  signup: "Signup",
  migration: "Pricing v2 migration",
  checkout: "Checkout",
  credit_purchase: "Credit purchase",
  plan_change: "Plan change",
  staff: "Staff",
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

function planName(plan: TeamPlan): string {
  return plan.terms.display_name || plan.plan_key
}

export function TeamBillingView({
  plans,
  catalog,
  staffCredits,
  region,
  teamId,
  canWrite,
}: {
  plans: TeamPlanAssignments | null
  catalog: PlanCatalog | null
  staffCredits: StaffCredit[] | null
  region: string
  teamId: string
  canWrite: boolean
}) {
  const current = plans?.current ?? null
  const pending = plans?.pending_change
  const pricingV2 = catalog?.pricingV2
  const canAssign = canWrite && pricingV2 && plans !== null
  const changeOptions = current ? (DOWNGRADES[current.kind] ?? []) : []

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
        {catalog === null ? (
          <Badge variant="muted">Pricing status unavailable</Badge>
        ) : (
          <Badge variant={catalog.pricingV2 ? "active" : "muted"}>
            {catalog.pricingV2 ? "Pricing v2" : "Legacy pricing"}
          </Badge>
        )}
      </div>

      <Section title="Plan">
        {plans === null ? (
          <p className="text-sm text-muted">
            The team's plan is unavailable. Try again shortly.
          </p>
        ) : current === null ? (
          <p className="text-sm text-muted">
            No plan assigned. Teams are assigned plans once pricing v2 is on;
            until then this team bills on its existing terms.
          </p>
        ) : (
          <div className="space-y-3">
            {pricingV2 === false ? (
              <p className="text-sm text-muted">
                New entry into pricing v2 is off in this region. Existing plans
                remain in effect; downgrades and undo are still available.
              </p>
            ) : null}
            <Facts
              items={[
                ["Plan", planName(current)],
                ["Kind", KINDS[current.kind] ?? current.kind],
                ["Since", formatDay(current.effective_from)],
                ["Limits", describeLimits(current.limits)],
                ["Assigned by", SOURCES[current.source] ?? current.source],
                ["Reason", current.reason || "—"],
              ]}
            />
          </div>
        )}
      </Section>

      {current ? (
        <Section title="Pending change">
          {pending === undefined ? (
            <p className="text-sm text-muted">
              Pending change status is unavailable.
            </p>
          ) : pending ? (
            <div className="space-y-4">
              <Facts
                items={[
                  ["Moves to", pending.target_display_name],
                  ["Takes effect", formatDay(pending.effective_at)],
                  [
                    "Running sandboxes",
                    pending.pauses_running
                      ? "Paused when it takes effect"
                      : "Unchanged",
                  ],
                  [
                    "Undo",
                    pending.undoable ? "Still possible" : "No longer possible",
                  ],
                ]}
              />
              {canWrite && pending.undoable ? (
                <UndoPlanChangeForm
                  region={region}
                  teamId={teamId}
                  changeId={pending.id}
                />
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted">No plan change is pending.</p>
              {canWrite && changeOptions.length > 0 ? (
                <PlanChangeForm
                  region={region}
                  teamId={teamId}
                  options={changeOptions}
                  freeLimits={catalog?.freeLimits ?? null}
                />
              ) : null}
            </div>
          )}
        </Section>
      ) : null}

      {canAssign ? (
        <Section title="Assign Enterprise or custom plan">
          <AssignPlanForm
            region={region}
            teamId={teamId}
            plans={catalog?.assignablePlans ?? []}
          />
        </Section>
      ) : null}

      <Section title="Staff credit">
        <div className="space-y-4">
          {staffCredits === null ? (
            <p className="text-sm text-muted">
              Staff credit history is unavailable.
            </p>
          ) : staffCredits.length === 0 ? (
            <p className="text-sm text-muted">No staff credit granted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffCredits.map((credit) => (
                  <TableRow key={credit.id}>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {formatCents(credit.amount_cents)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          credit.state === "issued" ? "active" : "warning"
                        }
                      >
                        {credit.state === "issued" ? "Issued" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted">
                      {formatDay(credit.requested_at)}
                    </TableCell>
                    <TableCell className="text-muted">
                      {credit.reason}
                      {credit.state === "pending" && credit.last_error ? (
                        <span className="block text-xs text-destructive">
                          {credit.last_error}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && credit.state === "pending" ? (
                        <ResumeStaffCreditButton
                          region={region}
                          teamId={teamId}
                          credit={credit}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canWrite && staffCredits !== null ? (
            <StaffCreditForm region={region} teamId={teamId} />
          ) : null}
        </div>
      </Section>

      <Section title="Plan history">
        {plans === null ? (
          <p className="text-sm text-muted">Plan history is unavailable.</p>
        ) : plans.history.length === 0 ? (
          <p className="text-sm text-muted">No plan history yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.history.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>{planName(plan)}</TableCell>
                  <TableCell className="text-muted">
                    {formatDay(plan.effective_from)}
                  </TableCell>
                  <TableCell className="text-muted">
                    {plan.effective_to
                      ? formatDay(plan.effective_to)
                      : "Current"}
                  </TableCell>
                  <TableCell className="text-muted">
                    {SOURCES[plan.source] ?? plan.source}
                  </TableCell>
                  <TableCell className="text-muted">
                    {plan.reason || "—"}
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
