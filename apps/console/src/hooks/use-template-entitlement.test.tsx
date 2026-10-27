import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  teamKey: "use:team-a" as string | null,
  ready: true,
  api: vi.fn(),
}))
vi.mock("./use-billing-context", () => ({
  useBillingContext: () => ({
    cacheScope: "self",
    teamKey: state.teamKey,
    ready: state.ready,
  }),
}))
vi.mock("@/lib/api/client", () => ({ apiClient: state.api }))
import { useTemplateEntitlement } from "./use-template-entitlement"
const response = (cap: number | null) => ({
  plan: {
    plan_key: "custom",
    kind: "free",
    display_name: "Configured",
    limits: {
      max_concurrent: 1,
      max_vcpu: 1,
      max_memory_mib: 1024,
      max_disk_mib: 4096,
      max_templates: cap,
    },
    effective_from: "2026-10-27T00:00:00Z",
  },
  period: { start: "2026-10-27T00:00:00Z", end: "2026-11-27T00:00:00Z" },
  pending_change: null,
})
beforeEach(() => {
  state.teamKey = "use:team-a"
  state.ready = true
  state.api.mockReset()
})
it("does not leak a cached positive entitlement into another team's pending zero-cap query", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  let finish!: (value: unknown) => void
  state.api.mockResolvedValueOnce(response(10)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const hook = renderHook(useTemplateEntitlement, { wrapper })
  await waitFor(() => expect(hook.result.current.status).toBe("allowed"))
  state.teamKey = "use:team-b"
  hook.rerender()
  expect(hook.result.current.status).toBe("loading")
  await act(async () => finish(response(0)))
  await waitFor(() => expect(hook.result.current.status).toBe("unavailable"))
  state.teamKey = "use:team-a"
  hook.rerender()
  await waitFor(() => expect(hook.result.current.status).toBe("allowed"))
  expect(state.api).toHaveBeenCalledTimes(2)
  hook.unmount()
  client.clear()
})
