import "server-only"
import type { User } from "@supabase/supabase-js"
import { after } from "next/server"

import { getImpersonationTeamId } from "@/lib/admin/impersonation"
import { isStripeCheckoutUrl } from "@/lib/api/plan-checkout"
import { membershipExistsInCell } from "@/lib/api/team-directory"
import { billingOffersSchema } from "@/lib/billing/plans"
import { cellFor } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

import { trackEvent } from "./actions"
import { CHECKOUT_EVENTS } from "./events"

// Server-side events for the paid Stripe Checkout funnel. The registry and
// the properties are described next to CHECKOUT_EVENTS in ./events.

export type CheckoutSurface = "plan_picker" | "billing_pro" | "onboarding_plan"
export type CheckoutOutcome = "success" | "cancel"

export interface CheckoutTeam {
  region: string
  teamId: string
}

type Properties = Record<string, unknown>

const LOOKUP_TIMEOUT_MS = 2_000
const SESSION_ID = /^cs_(?:live|test)_[A-Za-z0-9]+$/
const SESSION_IN_URL = /\/(cs_(?:live|test)_[A-Za-z0-9]+)(?:[/?#]|$)/
const OFFER_KEY = /^([a-z]+)_(monthly|annual)$/

// The Checkout session id from the backend's response id, or else from the
// Checkout URL, which carries it in its path.
export function checkoutSessionId(id?: unknown, url?: unknown): string | null {
  if (typeof id === "string" && SESSION_ID.test(id)) return id
  if (typeof url !== "string") return null
  try {
    return new URL(url).pathname.match(SESSION_IN_URL)?.[1] ?? null
  } catch {
    return null
  }
}

export function offerProperties(offer: string | null | undefined) {
  const key = typeof offer === "string" && offer ? offer : null
  const parsed = key?.match(OFFER_KEY)
  return {
    offer: key,
    plan: parsed ? parsed[1] : key,
    billing_interval: parsed ? parsed[2] : null,
  }
}

export function teamProperties({ region, teamId }: CheckoutTeam) {
  return { team_id: teamId, region, $groups: { team: teamId } }
}

export function parseTeamKey(value: unknown): CheckoutTeam | null {
  if (typeof value !== "string") return null
  const match = value.match(/^([a-z0-9-]+):([0-9a-f-]{36})$/i)
  return match ? { region: match[1], teamId: match[2] } : null
}

// The surface whose page a Checkout return URL or a Referer points at.
export function checkoutSurfaceFromUrl(value: unknown): {
  surface: CheckoutSurface
  outcome: CheckoutOutcome | null
} | null {
  if (typeof value !== "string") return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const path = url.pathname.replace(/\/$/, "")
  const surface =
    path === "/billing/pro"
      ? "billing_pro"
      : path === "/onboarding/plan"
        ? "onboarding_plan"
        : null
  if (!surface) return null
  const billing = url.searchParams.get("billing")
  return {
    surface,
    outcome: billing === "success" || billing === "cancel" ? billing : null,
  }
}

// The catalog list price of an offer, before tax and discounts, or null when
// the catalog can't be read.
export async function offerPriceCents(
  base: string,
  apiKey: string,
  offer: string | null,
): Promise<number | null> {
  if (!offer) return null
  try {
    const response = await fetch(new URL("/billing/capabilities", base), {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { offers?: unknown }
    return (
      billingOffersSchema
        .parse(body.offers)
        .find((entry) => entry.offer_key === offer)?.price_cents ?? null
    )
  } catch {
    return null
  }
}

interface CheckoutRecord {
  offer: string | null
  sessionId: string | null
  amountCents: number | null
}

// The team's latest paid Checkout, from the backend's purchase tables: a plan
// upgrade (it has the quoted charge) or the signup plan choice, whichever
// started last. The backend keeps one open purchase per team and resumes its
// Checkout session, so this is the session the customer returns from. The one
// gap: a cancel from the tab of an expired session that a new one replaced is
// attributed to the new session.
export async function readCheckoutRecord(
  team: CheckoutTeam,
): Promise<CheckoutRecord | null> {
  const admin = cellFor(team.region).createAdminClient()
  const [upgrade, choice] = await Promise.all([
    admin
      .from("billing_pro_upgrade")
      .select("offer_key, session_id, amount_cents, quoted_at")
      .eq("team_id", team.teamId)
      .not("session_id", "is", null)
      .order("quoted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("billing_signup_choice")
      .select("offer_key, session_id, generation")
      .eq("team_id", team.teamId)
      .not("session_id", "is", null)
      .maybeSingle(),
  ])
  type Row = {
    offer_key?: unknown
    session_id?: unknown
    amount_cents?: unknown
    quoted_at?: unknown
    generation?: unknown
  }
  const rows = [
    !upgrade.error && upgrade.data ? (upgrade.data as Row) : null,
    !choice.error && choice.data ? (choice.data as Row) : null,
  ].filter((row): row is Row => row !== null)
  const started = (row: Row) =>
    Date.parse(String(row.quoted_at ?? row.generation ?? "")) || 0
  const row = rows.toSorted((a, b) => started(b) - started(a))[0]
  if (!row) return null
  return {
    offer: typeof row.offer_key === "string" ? row.offer_key : null,
    sessionId: checkoutSessionId(row.session_id),
    amountCents: typeof row.amount_cents === "number" ? row.amount_cents : null,
  }
}

// An operator viewing another team is not a customer, so their session
// records nothing, as in the API proxy. A failed check records nothing too.
export async function isOperatorView(user: User): Promise<boolean> {
  try {
    return (await getImpersonationTeamId(user)) !== null
  } catch {
    return true
  }
}

// When an event happened. Each value is later than the one before it in this
// process, so two events recorded in order keep that order in PostHog even
// within one millisecond.
let lastOccurredAt = 0
function occurredAt(): Date {
  lastOccurredAt = Math.max(Date.now(), lastOccurredAt + 1)
  return new Date(lastOccurredAt)
}

// Sends the event after the response, so that a slow or failing PostHog or
// lookup never delays or fails a checkout. Outside a request it does nothing.
// The event is stamped with the time it was recorded, not the time it was
// sent: the callbacks run concurrently and their lookups take different
// times, so a later event (checkout_completed) can be sent before an earlier
// one (checkout_returned).
function record(
  event: string,
  distinctId: string,
  build: () => Promise<Properties | null>,
) {
  const timestamp = occurredAt()
  try {
    after(async () => {
      try {
        const properties = await build()
        if (properties)
          await trackEvent(event, distinctId, properties, timestamp)
      } catch {
        // Analytics must never affect checkout.
      }
    })
  } catch {
    // after() throws outside a request scope.
  }
}

interface OpenedInput {
  surface: CheckoutSurface
  team: CheckoutTeam
  offer: string
  base: string
  apiKey: string
  response: { id?: unknown; url?: unknown }
  reason?: string | null
  explicitChoice?: boolean
}

// A paid purchase that needs a new card resumes with a setup-only Checkout
// (billing_pro_upgrade_setup). It is not a new paid Checkout, so it is not
// counted as opened. A failed lookup counts the Checkout.
async function isCardSetupSession(team: CheckoutTeam, sessionId: string) {
  const { data, error } = await cellFor(team.region)
    .createAdminClient()
    .from("billing_pro_upgrade_setup")
    .select("id")
    .eq("session_id", sessionId)
    .limit(1)
    .maybeSingle()
  return !error && data !== null
}

async function openedProperties(
  input: OpenedInput,
): Promise<Properties | null> {
  const sessionId = checkoutSessionId(input.response.id, input.response.url)
  if (sessionId && (await isCardSetupSession(input.team, sessionId)))
    return null
  return {
    surface: input.surface,
    ...offerProperties(input.offer),
    price_cents: await offerPriceCents(input.base, input.apiKey, input.offer),
    reason: input.reason ?? null,
    explicit_choice: input.explicitChoice ?? false,
    checkout_session_id: sessionId,
    ...teamProperties(input.team),
  }
}

interface CompletedInput {
  surface: CheckoutSurface
  team: CheckoutTeam
  // Without a backend key the catalog isn't read and price_cents is null.
  base?: string
  apiKey?: string
}

// Only a team with a paid Checkout on record counts, so a team that already
// had its plan doesn't complete a checkout it never opened.
async function completedProperties(
  input: CompletedInput,
): Promise<Properties | null> {
  const checkout = await readCheckoutRecord(input.team)
  if (!checkout?.sessionId) return null
  return {
    surface: input.surface,
    ...offerProperties(checkout.offer),
    price_cents:
      input.base && input.apiKey
        ? await offerPriceCents(input.base, input.apiKey, checkout.offer)
        : null,
    amount_cents: checkout.amountCents,
    checkout_session_id: checkout.sessionId,
    ...teamProperties(input.team),
  }
}

export function recordCheckoutOpened(input: OpenedInput & { userId: string }) {
  record(CHECKOUT_EVENTS.OPENED, input.userId, () => openedProperties(input))
}

export function recordCheckoutCompleted(
  input: CompletedInput & { userId: string },
) {
  record(CHECKOUT_EVENTS.COMPLETED, input.userId, () =>
    completedProperties(input),
  )
}

// teamKey comes from the return URL, so the team is checked against the
// user's memberships before anything is read or sent.
export function recordCheckoutReturned(input: {
  userId: string
  surface: CheckoutSurface
  outcome: CheckoutOutcome
  teamKey: unknown
  offer?: string | null
}) {
  const team = parseTeamKey(input.teamKey)
  if (!team) return
  record(CHECKOUT_EVENTS.RETURNED, input.userId, async () => {
    if (!(await membershipExistsInCell(team.region, input.userId, team.teamId)))
      return null
    const checkout = await readCheckoutRecord(team).catch(() => null)
    return {
      surface: input.surface,
      outcome: input.outcome,
      ...offerProperties(checkout?.offer ?? input.offer),
      checkout_session_id: checkout?.sessionId ?? null,
      ...teamProperties(team),
    }
  })
}

// recordCheckoutReturned for the signed-in user. account, when given, is the
// account the return URL names; another account's return is not recorded.
export async function recordCheckoutReturnForUser(input: {
  surface: CheckoutSurface
  outcome: CheckoutOutcome
  teamKey: unknown
  offer?: string | null
  account?: unknown
}) {
  try {
    if (!parseTeamKey(input.teamKey)) return
    const {
      data: { user },
    } = await (await createServerClient()).auth.getUser()
    if (!user || (input.account !== undefined && input.account !== user.id))
      return
    if (await isOperatorView(user)) return
    recordCheckoutReturned({ ...input, userId: user.id })
  } catch {
    // Analytics never affects the page.
  }
}

// A plan request the console proxy forwarded: a Checkout it created, or a
// recovery that may confirm the plan.
export type ProxyCheckoutRequest =
  | { kind: "opened"; offer: string; successUrl: string }
  | { kind: "recovered"; referer: string | null }

// A recovery reports "active" for any team on a paid plan, so it completes a
// checkout only when the page asking is the one Checkout returned to after a
// payment (?billing=success). /onboarding/plan completes through its plan
// refresh instead (getSignupPlanAction), so it is not counted twice.
export function recordProxyCheckout(input: {
  request: ProxyCheckoutRequest
  response: Response
  userId: string
  team: CheckoutTeam
  base: string
  apiKey: string
}) {
  const { request, response } = input
  if (!response.ok) return
  const page =
    request.kind === "opened"
      ? checkoutSurfaceFromUrl(request.successUrl)
      : checkoutSurfaceFromUrl(request.referer)
  if (
    request.kind === "recovered" &&
    (page?.outcome !== "success" || page.surface !== "billing_pro")
  )
    return
  let copy: Response
  try {
    copy = response.clone()
  } catch {
    return
  }
  const surface = page?.surface ?? "billing_pro"
  if (request.kind === "opened") {
    record(CHECKOUT_EVENTS.OPENED, input.userId, async () => {
      const body = (await copy.json()) as { id?: unknown; url?: unknown }
      if (typeof body.url !== "string" || !isStripeCheckoutUrl(body.url))
        return null
      return openedProperties({
        ...input,
        surface,
        offer: request.offer,
        response: body,
      })
    })
    return
  }
  record(CHECKOUT_EVENTS.COMPLETED, input.userId, async () => {
    const body = (await copy.json()) as { outcome?: unknown }
    if (body.outcome !== "active") return null
    return completedProperties({ ...input, surface })
  })
}
