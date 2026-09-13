/**
 * /qm/[id] detail — the step list rendered from event streams (success,
 * failure at step 4, retry), the one-time admin link, and leaving the page
 * once the stack is gone.
 */

import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"
import {
  failedAtStep4Events,
  failedTeardownEvents,
  inProgressEvents,
  qmDetail,
  qmEvent,
  qmTenant,
  successEvents,
  T,
} from "@/test/qm-fixtures"
import { createQueryClient } from "@/test/react-query"

const mockGet = vi.fn()
const mockDelete = vi.fn()
const mockRetry = vi.fn()
const mockAdminLink = vi.fn()
vi.mock("@/lib/api/qm", () => ({
  getQmTenant: (...a: unknown[]) => mockGet(...a),
  deleteQmTenant: (...a: unknown[]) => mockDelete(...a),
  retryQmTenant: (...a: unknown[]) => mockRetry(...a),
  getQmAdminLink: (...a: unknown[]) => mockAdminLink(...a),
}))

const addToast = vi.fn()
vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return {
    ...actual,
    useToast: () => ({ addToast }),
    // Base UI's dialog portals + focus traps are out of scope here.
    Dialog: ({
      children,
      open,
    }: {
      children: React.ReactNode
      open: boolean
    }) => (open ? <div role="dialog">{children}</div> : null),
    DialogPopup: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
    DialogFooter: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  }
})

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useParams: () => ({ id: "t1" }),
}))
const teamContext = vi.hoisted(() => ({ value: null as object | null }))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => "self",
  useDashboardTeamContext: () => teamContext.value,
}))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

import QmTenantDetailPage from "./page"

function renderPage() {
  const queryClient = createQueryClient()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <QmTenantDetailPage />
    </QueryClientProvider>,
  )
  return { ...utils, queryClient }
}

/**
 * Fixture streams are dated 2026-01-01. Tests that render them as still in
 * flight pin the clock just after the newest event so the run doesn't read
 * as stalled. Only `Date` is faked: timers stay real for React Query and
 * the countdown interval.
 */
function freezeClockAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(iso))
}

const steps = () =>
  within(
    screen.getByRole("list", { name: /provisioning steps/i }),
  ).getAllByRole("listitem")

describe("QmTenantDetailPage", () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockDelete.mockReset()
    mockRetry.mockReset()
    mockAdminLink.mockReset()
    addToast.mockClear()
    nav.replace.mockClear()
    teamContext.value = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("promises no retention window unless one is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "")
    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    renderPage()
    await userEvent.click(
      (await screen.findAllByRole("button", { name: /delete stack/i }))[0],
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent(/permanently erased/)
    expect(dialog).not.toHaveTextContent(/kept for/)
    expect(screen.queryByText(/kept for/)).not.toBeInTheDocument()
  })

  it("renders the live step list while provisioning", async () => {
    freezeClockAt(T(10))
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
        inProgressEvents(),
      ),
    )
    renderPage()

    expect((await screen.findAllByText("Provisioning")).length).toBeGreaterThan(
      0,
    )
    const rows = steps()
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent("Create database")
    expect(rows[0]).toHaveAttribute("data-status", "ok")
    expect(rows[0]).toHaveTextContent("2s")
    expect(rows[2]).toHaveTextContent("Create storage bucket")
    expect(rows[3]).toHaveTextContent("Store secrets")
    expect(rows[3]).toHaveAttribute("data-status", "started")
    expect(rows[3]).toHaveTextContent("Running")
    // Nothing to sign in to yet, and no danger zone mid-flight.
    expect(
      screen.queryByRole("button", { name: /open admin sign-in/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument()
  })

  it("offers retry and delete once an in-flight run has gone quiet", async () => {
    // Fixture timestamps are in 2026-01-01; "now" is far later, so the run
    // has been silent for well over the stale threshold.
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
        inProgressEvents(),
      ),
    )
    mockRetry.mockResolvedValue(
      qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
    )
    renderPage()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/hasn't reported progress for/)
    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith("t1"))
    expect(
      within(alert).getByRole("button", { name: /delete/i }),
    ).toBeInTheDocument()
  })

  it("does not call a fresh in-flight run stalled", async () => {
    const recent = new Date().toISOString()
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
        [
          {
            ...qmEvent("run", "started", recent, "provision started"),
            detail: { mode: "provision" },
          },
          qmEvent("database", "started", recent),
        ],
      ),
    )
    renderPage()
    await screen.findByRole("list", { name: /provisioning steps/i })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument()
  })

  it("shows a ready stack with its details and no step list", async () => {
    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "acme" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("list", { name: /provisioning steps/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("v0.4.2")).toBeInTheDocument()
    expect(screen.getAllByText("admin@example.com").length).toBeGreaterThan(0)
    expect(screen.getByText("Magic link")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /^open$/i })).toHaveAttribute(
      "href",
      "https://acme.qm.superserve.ai",
    )
    expect(screen.getByText(/danger zone/i)).toBeInTheDocument()
  })

  it("surfaces the failure at step 4 with retry and delete", async () => {
    freezeClockAt(T(70))
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "failed", publicUrl: null, imageTag: null }),
        failedAtStep4Events(),
      ),
    )
    mockRetry.mockResolvedValue(
      qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
    )
    renderPage()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Provisioning failed")
    // The run's user-safe message, not the step's raw "secrets failed".
    expect(alert).toHaveTextContent(/Provisioning stopped at secrets/)

    const rows = steps()
    expect(rows).toHaveLength(9)
    expect(rows[3]).toHaveAttribute("data-status", "failed")
    expect(rows[3]).toHaveTextContent("Store secrets")
    expect(rows[3]).toHaveTextContent("30s")
    expect(rows.slice(0, 3).every((r) => r.dataset.status === "ok")).toBe(true)
    expect(rows.slice(4).every((r) => r.dataset.status === "skipped")).toBe(
      true,
    )

    // Once retried, a new run starts and the poll sees it provisioning.
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "provisioning", publicUrl: null, imageTag: null }),
        [
          ...failedAtStep4Events(),
          {
            ...qmEvent("run", "started", T(60), "provision started"),
            detail: { mode: "provision" },
          },
          qmEvent("database", "started", T(61)),
        ],
      ),
    )
    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith("t1"))
    // Optimistic patch from the retry response flips the status.
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    )
    expect(screen.getAllByText("Provisioning").length).toBeGreaterThan(0)
    // The list is rebuilt from the new run: one step, running.
    await waitFor(() => expect(steps()).toHaveLength(1))
    expect(steps()[0]).toHaveAttribute("data-status", "started")
  })

  it("labels a failed teardown as such and retries it", async () => {
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "7")
    mockGet.mockResolvedValue(
      qmDetail(qmTenant({ status: "failed" }), failedTeardownEvents()),
    )
    mockRetry.mockResolvedValue(qmTenant({ status: "deprovisioning" }))
    renderPage()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Teardown failed")
    expect(alert).toHaveTextContent(/Deprovisioning stopped at cloud_run/)
    expect(
      screen.getByRole("heading", { name: "Teardown" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/data kept 7 days/i)).toBeInTheDocument()
    const rows = steps()
    expect(rows[0]).toHaveTextContent("Admin sign-in")
    expect(rows[4]).toHaveTextContent("Remove QM deployment")
    expect(rows[4]).toHaveAttribute("data-status", "failed")

    mockGet.mockResolvedValue(
      qmDetail(qmTenant({ status: "deprovisioning" }), failedTeardownEvents()),
    )
    await userEvent.click(within(alert).getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith("t1"))
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("Retrying teardown", "success"),
    )
  })

  it("offers only deletion when the provider key was never stored", async () => {
    mockGet.mockResolvedValue(
      qmDetail(
        qmTenant({ status: "failed", publicUrl: null, imageTag: null }),
        [
          qmEvent(
            "model_key",
            "failed",
            T(0),
            "The model key could not be stored. Delete this tenant and create it again.",
          ),
        ],
      ),
    )
    renderPage()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/model key could not be stored/)
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /delete/i }).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText("No steps ran.")).toBeInTheDocument()
  })

  it("hides every mutation while viewing another team", async () => {
    teamContext.value = { teamId: "team-b", region: "use", name: "Other" }
    mockGet.mockResolvedValue(
      qmDetail(qmTenant({ status: "failed" }), failedAtStep4Events()),
    )
    const { unmount } = renderPage()

    await screen.findByRole("alert")
    expect(screen.getByText("Read-only")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument()
    unmount()

    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    renderPage()
    await screen.findByRole("heading", { name: "acme" })
    expect(
      screen.queryByRole("button", { name: /open admin sign-in/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument()
  })

  it("mints the admin link once, shows a countdown, and never caches it", async () => {
    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    const url = "https://acme.qm.superserve.ai/auth/one-time/abc123"
    mockAdminLink.mockResolvedValue({
      url,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    })
    const { queryClient, unmount } = renderPage()

    const button = await screen.findByRole("button", {
      name: /open admin sign-in/i,
    })
    await userEvent.click(button)

    expect(await screen.findByTestId("admin-link-url")).toHaveTextContent(url)
    // Kept out of session replay and autocapture.
    const row = screen.getByTestId("admin-link-row")
    expect(row).toHaveClass("ph-no-capture")
    expect(row).toHaveAttribute("data-mask")
    expect(screen.getByText(/expires in 1:/i)).toBeInTheDocument()
    expect(screen.getByText(/single-use/i)).toBeInTheDocument()
    expect(
      screen
        .getAllByRole("link", { name: /^open$/i })
        .some((a) => a.getAttribute("href") === url),
    ).toBe(true)
    expect(mockAdminLink).toHaveBeenCalledTimes(1)
    // The button is gone while a link is shown, so it can't be re-minted by
    // accident, and the credential is nowhere in the query cache.
    expect(
      screen.queryByRole("button", { name: /open admin sign-in/i }),
    ).not.toBeInTheDocument()
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain("abc123")
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)

    // Leaving the page drops it; coming back shows only the mint button.
    unmount()
    render(
      <QueryClientProvider client={queryClient}>
        <QmTenantDetailPage />
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole("button", { name: /open admin sign-in/i }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId("admin-link-url")).not.toBeInTheDocument()
  })

  it("hides an expired link", async () => {
    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    mockAdminLink.mockResolvedValue({
      url: "https://acme.qm.superserve.ai/auth/one-time/xyz",
      expiresAt: new Date(Date.now() + 1_500).toISOString(),
    })
    renderPage()
    await userEvent.click(
      await screen.findByRole("button", { name: /open admin sign-in/i }),
    )
    await screen.findByTestId("admin-link-url")
    await waitFor(
      () =>
        expect(screen.queryByTestId("admin-link-url")).not.toBeInTheDocument(),
      { timeout: 4000 },
    )
  })

  it("deletes after the slug is typed and leaves once the stack is gone", async () => {
    vi.stubEnv("NEXT_PUBLIC_QM_RETENTION_DAYS", "7")
    freezeClockAt(T(210))
    mockGet.mockResolvedValue(qmDetail(qmTenant(), successEvents()))
    mockDelete.mockResolvedValue(qmTenant({ status: "deprovisioning" }))
    renderPage()

    await userEvent.click(
      (await screen.findAllByRole("button", { name: /delete stack/i }))[0],
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent(/7 days/)
    const confirm = within(dialog).getByRole("button", {
      name: /delete stack/i,
    })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByRole("textbox"), "acme")
    // Subsequent polls see the teardown in progress.
    mockGet.mockResolvedValue(
      qmDetail(qmTenant({ status: "deprovisioning" }), [
        qmEvent("teardown", "started", T(200)),
      ]),
    )
    await userEvent.click(confirm)

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("t1"))
    expect((await screen.findAllByText("Deleting")).length).toBeGreaterThan(0)
    expect(screen.getByText(/data kept 7 days/i)).toBeInTheDocument()
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument()

    // Poll returns deleted → back to the list.
    mockGet.mockResolvedValue(qmDetail(qmTenant({ status: "deleted" })))
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm"), {
      timeout: 4000,
    })
  })

  it("treats a 404 as gone", async () => {
    mockGet.mockRejectedValue(new ApiError(404, "not_found", "Not found"))
    renderPage()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm"))
  })
})
