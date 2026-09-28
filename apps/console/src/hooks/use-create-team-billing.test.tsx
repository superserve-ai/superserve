import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import type { BillingSummaryResponse } from "@/lib/api/billing"
import {
  apiKeyKeys,
  billingKeys,
  sandboxKeys,
  snapshotKeys,
  teamKeys,
} from "@/lib/api/query-keys"
import type {
  TeamDirectoryResponse,
  TeamSummary,
} from "@/lib/api/teams-actions"

import { useBillingContext } from "./use-billing-context"
import { useBillingPayment } from "./use-billing-payment"
import { useBillingSummary } from "./use-billing-summary"
import { useCreateTeam } from "./use-teams"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  directory: vi.fn(),
  summary: vi.fn(),
  checkout: vi.fn(),
  toast: vi.fn(),
}))
vi.mock("@/lib/api/teams-actions", () => ({
  createTeamAction: mocks.create,
  listTeamsAction: mocks.directory,
  setActiveTeamAction: vi.fn(),
}))
vi.mock("@/lib/api/billing", () => ({ getBillingSummary: mocks.summary }))
vi.mock("@/lib/api/billing-stripe", () => ({
  createStripeCheckoutSession: mocks.checkout,
  createStripeCustomerPortalSession: vi.fn(),
}))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => "self",
  useDashboardTeamContext: () => null,
}))
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mocks.toast }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const teamA = { id: "a", region: "use", name: "A" }
const teamB = { id: "b", region: "usw", name: "B" }
const directory: TeamDirectoryResponse = {
  teams: [teamA],
  regions: ["use", "usw"],
  activeTeamId: "a",
  activeRegion: "use",
}
const summaryA = {
  permissions: { can_view: true, can_manage: true },
  checkout_available: true,
  trial: { state: "active", remaining_usd: 4 },
} as BillingSummaryResponse
const summaryB = {
  ...summaryA,
  trial: { state: "exhausted", remaining_usd: 0 },
} as BillingSummaryResponse

let client: QueryClient
beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(teamKeys.directory(), directory)
  client.setQueryData(
    billingKeys.summary({ cacheScope: "self", teamKey: "use:a" }),
    summaryA,
  )
})
afterEach(() => client.clear())

function setup() {
  return renderHook(
    () => {
      const context = useBillingContext()
      const summary = useBillingSummary()
      const payment = useBillingPayment(summary.data, context.teamKey)
      const create = useCreateTeam()
      return { context, summary, payment, create }
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
}

it("keeps the current team when creation returns a signup denial", async () => {
  mocks.create.mockResolvedValue({
    code: "signup_blocked",
    message: "Signup is not available. Please try again later.",
  })
  const { result } = setup()

  await act(async () => {
    await result.current.create
      .mutateAsync({ name: "blocked", region: "usw" })
      .catch(() => {})
  })

  await waitFor(() =>
    expect(result.current.create.error?.message).toBe(
      "Signup is not available. Please try again later.",
    ),
  )
  expect(
    client.getQueryData<TeamDirectoryResponse>(teamKeys.directory()),
  ).toEqual(directory)
})

it.each([false, true])(
  "clears old team data immediately and keeps billing guarded through directory reconciliation (failure: %s)",
  async (failDirectory) => {
    const creation = deferred<TeamSummary>()
    const refresh = deferred<TeamDirectoryResponse>()
    const staleDirectory = deferred<TeamDirectoryResponse>()
    const scopedKeys = [
      sandboxKeys.list({
        page: 1,
        pageSize: 20,
        sort: "created_at",
        order: "desc",
      }),
      apiKeyKeys.list(),
      snapshotKeys.list(),
    ]
    for (const key of scopedKeys) {
      client.setQueryData(key, [{ id: "team-a-resource" }])
    }
    mocks.create.mockReturnValue(creation.promise)
    mocks.directory
      .mockReturnValueOnce(staleDirectory.promise)
      .mockReturnValueOnce(refresh.promise)
    mocks.summary.mockResolvedValue(summaryB)
    const { result } = setup()

    // A directory request made before creation must not restore the old selection.
    let staleRead!: Promise<void>
    act(() => {
      staleRead = client.invalidateQueries({ queryKey: teamKeys.directory() })
      result.current.create.mutate({ name: "B", region: "usw" })
    })
    await waitFor(() => expect(result.current.context.ready).toBe(false))
    await act(() => result.current.payment.openSession())
    expect(mocks.checkout).not.toHaveBeenCalled()
    await act(async () => creation.resolve(teamB))
    await waitFor(() => expect(mocks.directory).toHaveBeenCalledTimes(2))
    expect(
      client.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
        ?.activeTeamId,
    ).toBe("b")
    // Navigation must not reuse the old team's rows during the pending refresh.
    for (const key of scopedKeys) {
      expect(client.getQueryData(key)).toBeUndefined()
    }
    expect(result.current.create.isPending).toBe(true)
    expect(result.current.context.ready).toBe(false)
    expect(mocks.summary).not.toHaveBeenCalled()
    await act(async () => {
      staleDirectory.resolve(directory)
      await staleRead
    })
    expect(
      client.getQueryData<TeamDirectoryResponse>(teamKeys.directory())
        ?.activeTeamId,
    ).toBe("b")

    await act(async () => {
      if (failDirectory) refresh.reject(new Error("Directory unavailable"))
      else
        refresh.resolve({
          ...directory,
          teams: [teamA, teamB],
          activeTeamId: "b",
          activeRegion: "usw",
        })
    })
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.summary.data).toEqual(summaryB))
    expect(result.current.context).toMatchObject({
      teamKey: "usw:b",
      ready: true,
    })
    expect(
      client.getQueryData(
        billingKeys.summary({ cacheScope: "self", teamKey: "use:a" }),
      ),
    ).toBeUndefined()
    expect(
      client.getQueryData(
        billingKeys.summary({ cacheScope: "self", teamKey: "usw:b" }),
      ),
    ).toEqual(summaryB)
    expect(mocks.summary).toHaveBeenCalledTimes(1)
  },
)

it("restores billing readiness on creation failure and ignores payment completion during creation", async () => {
  const creation = deferred<TeamSummary>()
  const checkout = deferred<{ url: string }>()
  mocks.create.mockReturnValue(creation.promise)
  mocks.checkout.mockReturnValue(checkout.promise)
  const { result } = setup()
  let payment!: Promise<void>
  act(() => {
    payment = result.current.payment.openSession()
    result.current.create.mutate({ name: "B", region: "usw" })
  })
  await waitFor(() => expect(result.current.context.ready).toBe(false))
  await act(async () => {
    checkout.reject(new Error("Old team's payment failed"))
    await payment
  })
  expect(mocks.toast).not.toHaveBeenCalled()
  await act(async () => creation.reject(new Error("Creation failed")))
  await waitFor(() => expect(result.current.create.isError).toBe(true))
  expect(result.current.context).toMatchObject({
    teamKey: "use:a",
    ready: true,
  })
  expect(result.current.summary.data).toEqual(summaryA)
  expect(mocks.summary).not.toHaveBeenCalled()
})
