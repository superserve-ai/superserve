import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { QueryProvider } from "@/components/query-provider"
import type {
  BillingPricingResponse,
  BillingSummaryResponse,
} from "@/lib/api/billing"
import { billingKeys } from "@/lib/api/query-keys"
import type { TeamDirectoryResponse } from "@/lib/api/teams-actions"
import { billingFixture } from "@/test/ui/ss669/fixtures"

import SettingsPage from "./page"

const getBillingSummary = vi.fn()
const getBillingPricing = vi.fn()
let directory: TeamDirectoryResponse | undefined
let client: QueryClient

vi.mock("@/lib/api/billing", () => ({
  getBillingSummary: () => getBillingSummary(),
  getBillingPricing: () => getBillingPricing(),
  getBillingUsageSeries: vi.fn(),
}))
vi.mock("@/hooks/use-teams", () => ({ useTeams: () => ({ data: directory }) }))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "user", email: "fixture@example.test" },
    loading: false,
  }),
}))
vi.mock("@/components/settings/teams-section", () => ({
  TeamsSection: () => null,
}))
vi.mock("@/lib/api/billing-actions", () => ({ getBillingUsageAction: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))
vi.mock("@superserve/ui", async () => ({
  ...(await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")),
  useToast: () => ({ addToast: vi.fn() }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function Page({ disableRetries = false }: { disableRetries?: boolean }) {
  client = useQueryClient()
  if (disableRetries) client.setQueryDefaults(billingKeys.all, { retry: false })
  return <SettingsPage />
}

function selectTeam(id: string, region: string) {
  directory = {
    teams: [{ id, region, name: id }],
    activeTeamId: id,
    activeRegion: region,
    regions: [region],
  }
}

describe("Settings billing context isolation", () => {
  beforeEach(() => {
    getBillingSummary.mockReset()
    getBillingPricing.mockReset()
    selectTeam("team-a", "use")
  })
  afterEach(() => client?.clear())

  it.each(["summary", "pricing"] as const)(
    "clears retained %s claims after a failed refresh and recovers on retry",
    async (resource) => {
      const initial = billingFixture("paid")
      const recovered = billingFixture("tracked")
      recovered.pricing.rates.find(
        (rate) => rate.resource_key === "storage_gib",
      )!.price_usd_hourly = 0.000216
      const recovery = deferred<
        BillingSummaryResponse | BillingPricingResponse
      >()
      const failure = new Error("refresh failed")
      getBillingSummary.mockResolvedValue(initial.summary)
      getBillingPricing.mockResolvedValue(initial.pricing)
      const getter =
        resource === "summary" ? getBillingSummary : getBillingPricing
      const queryKey = (
        resource === "summary" ? billingKeys.summary : billingKeys.settings
      )({
        cacheScope: "self",
        teamKey: "use:team-a",
      })
      render(
        <QueryProvider>
          <Page disableRetries />
        </QueryProvider>,
      )
      expect(await screen.findByText("Billed")).toBeInTheDocument()
      expect(
        await screen.findByText("$0.000108 / GiB-hour"),
      ).toBeInTheDocument()

      getter
        .mockRejectedValueOnce(failure)
        .mockReturnValueOnce(recovery.promise)
      await act(async () => {
        await client.invalidateQueries({ queryKey, exact: true })
      })
      await waitFor(() => {
        expect(client.getQueryState(queryKey)).toMatchObject({
          status: "error",
          data: initial[resource],
          error: failure,
          fetchStatus: "idle",
        })
        if (resource === "summary") {
          expect(
            screen.queryByText("Usage-based billing"),
          ).not.toBeInTheDocument()
          expect(screen.queryByText("Billed")).not.toBeInTheDocument()
        } else {
          expect(screen.getAllByText("Unavailable")).toHaveLength(3)
          expect(
            screen.queryByText("$0.000108 / GiB-hour"),
          ).not.toBeInTheDocument()
          expect(screen.getByText("Billed")).toBeInTheDocument()
        }
      })
      expect(getter).toHaveBeenCalledTimes(2)
      expect(
        screen.queryByText("Tracked only · Not billed"),
      ).not.toBeInTheDocument()

      act(() => {
        void client.refetchQueries({ queryKey, exact: true })
      })
      await waitFor(() => expect(getter).toHaveBeenCalledTimes(3))
      await act(async () => {
        recovery.resolve(recovered[resource])
      })
      await waitFor(() => {
        expect(client.getQueryState(queryKey)).toMatchObject({
          status: "success",
          data: recovered[resource],
          error: null,
        })
        if (resource === "summary") {
          expect(
            screen.getByText("Tracked only · Not billed"),
          ).toBeInTheDocument()
          expect(screen.queryByText("Billed")).not.toBeInTheDocument()
          expect(screen.getByText("$0.000108 / GiB-hour")).toBeInTheDocument()
        } else {
          expect(screen.getByText("$0.000216 / GiB-hour")).toBeInTheDocument()
          expect(screen.getByText("Billed")).toBeInTheDocument()
          expect(screen.queryByText("Unavailable")).not.toBeInTheDocument()
        }
      })
    },
  )

  it("does not fetch or claim billing state before the team resolves", async () => {
    directory = undefined
    const fixture = billingFixture("paid")
    getBillingSummary.mockResolvedValue(fixture.summary)
    getBillingPricing.mockResolvedValue(fixture.pricing)
    const view = () => (
      <QueryProvider>
        <Page />
      </QueryProvider>
    )
    const { rerender } = render(view())
    expect(getBillingSummary).not.toHaveBeenCalled()
    expect(getBillingPricing).not.toHaveBeenCalled()
    expect(screen.queryByText("Usage-based billing")).not.toBeInTheDocument()
    selectTeam("team-a", "use")
    rerender(view())
    expect(await screen.findByText("Billed")).toBeInTheDocument()
    expect(await screen.findByText("$0.000108 / GiB-hour")).toBeInTheDocument()
  })

  it.each([
    { label: "team", team: "team-b", region: "use", scope: "self" },
    { label: "region", team: "team-a", region: "usw", scope: "self" },
    { label: "impersonation", team: "team-a", region: "use", scope: "team-a" },
  ])(
    "does not combine responses across a $label switch",
    async ({ team, region, scope }) => {
      const a = billingFixture("paid")
      const b = billingFixture("tracked")
      b.pricing.rates.find(
        (rate) => rate.resource_key === "storage_gib",
      )!.price_usd_hourly = 0.000216
      const lateSummary = deferred<BillingSummaryResponse>()
      const latePricing = deferred<BillingPricingResponse>()
      const nextSummary = deferred<BillingSummaryResponse>()
      const nextPricing = deferred<BillingPricingResponse>()
      getBillingSummary
        .mockResolvedValueOnce(a.summary)
        .mockReturnValueOnce(lateSummary.promise)
        .mockReturnValueOnce(nextSummary.promise)
      getBillingPricing
        .mockResolvedValueOnce(a.pricing)
        .mockReturnValueOnce(latePricing.promise)
        .mockReturnValueOnce(nextPricing.promise)
      let activeScope = "self"
      const view = () => (
        <QueryProvider
          cacheScope={activeScope}
          teamContext={
            activeScope === "self" ? null : { teamId: team, region, name: team }
          }
        >
          <Page />
        </QueryProvider>
      )
      const { rerender } = render(view())
      expect(await screen.findByText("Billed")).toBeInTheDocument()
      expect(
        await screen.findByText("$0.000108 / GiB-hour"),
      ).toBeInTheDocument()
      act(() => {
        void client.invalidateQueries({ queryKey: ["billing"] })
      })
      await waitFor(() => {
        expect(getBillingSummary).toHaveBeenCalledTimes(2)
        expect(getBillingPricing).toHaveBeenCalledTimes(2)
      })

      selectTeam(team, region)
      activeScope = scope
      rerender(view())
      // Assert immediately so even a one-render flash of the old team fails.
      expect(screen.queryByText("Billed")).not.toBeInTheDocument()
      expect(screen.queryByText("$0.000108 / GiB-hour")).not.toBeInTheDocument()
      await waitFor(() => {
        expect(getBillingSummary).toHaveBeenCalledTimes(3)
        expect(getBillingPricing).toHaveBeenCalledTimes(3)
      })

      await act(async () => {
        nextPricing.resolve(b.pricing)
        lateSummary.resolve(a.summary)
      })
      expect(screen.queryByText("Usage-based billing")).not.toBeInTheDocument()
      await act(async () => {
        nextSummary.resolve(b.summary)
      })
      expect(
        await screen.findByText("Tracked only · Not billed"),
      ).toBeInTheDocument()
      expect(
        await screen.findByText("$0.000216 / GiB-hour"),
      ).toBeInTheDocument()
      await act(async () => {
        latePricing.resolve(a.pricing)
      })
      expect(screen.getByText("Tracked only · Not billed")).toBeInTheDocument()
      expect(screen.getByText("$0.000216 / GiB-hour")).toBeInTheDocument()
      expect(screen.queryByText("Billed")).not.toBeInTheDocument()
      expect(screen.queryByText("$0.000108 / GiB-hour")).not.toBeInTheDocument()
    },
  )
})
