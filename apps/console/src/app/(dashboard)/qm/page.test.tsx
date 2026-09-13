/**
 * /qm entry page — branches on how many stacks the team has: none shows the
 * empty state, exactly one redirects straight to its detail page (no table
 * flash), and several show the table.
 */

import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { qmTenant } from "@/test/qm-fixtures"
import { createQueryClient } from "@/test/react-query"

const mockList = vi.fn()
vi.mock("@/lib/api/qm", () => ({
  listQmTenants: (...a: unknown[]) => mockList(...a),
}))

const addToast = vi.fn()
vi.mock("@superserve/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@superserve/ui")>("@superserve/ui")
  return { ...actual, useToast: () => ({ addToast }) }
})

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/qm",
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

import QmPage from "./page"

function renderPage() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <QmPage />
    </QueryClientProvider>,
  )
}

describe("QmPage", () => {
  beforeEach(() => {
    mockList.mockReset()
    nav.push.mockClear()
    nav.replace.mockClear()
    teamContext.value = null
  })

  it("shows a read-only empty state while viewing another team", async () => {
    teamContext.value = { teamId: "team-b", region: "use", name: "Other" }
    mockList.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText("No QM stack yet")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /create your qm stack/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/read-only while viewing/i)).toBeInTheDocument()
  })

  it("shows the empty state with a create CTA when the team has no stack", async () => {
    mockList.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText("No QM stack yet")).toBeInTheDocument()
    const cta = screen.getByRole("link", { name: /create your qm stack/i })
    expect(cta).toHaveAttribute("href", "/qm/new")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("redirects to the only stack without rendering a table", async () => {
    mockList.mockResolvedValue([qmTenant({ id: "t1" })])
    renderPage()

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm/t1"))
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(screen.queryByText("No QM stack yet")).not.toBeInTheDocument()
  })

  it("ignores deleted stacks when counting", async () => {
    mockList.mockResolvedValue([
      qmTenant({ id: "t1" }),
      qmTenant({ id: "t9", slug: "old", status: "deleted" }),
    ])
    renderPage()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm/t1"))
  })

  it("lists several stacks and opens one on row click", async () => {
    mockList.mockResolvedValue([
      qmTenant({ id: "t1", slug: "acme", status: "ready" }),
      qmTenant({
        id: "t2",
        slug: "pilot-team",
        status: "provisioning",
        imageTag: null,
        publicUrl: null,
        adminEmail: "lead@example.com",
      }),
      qmTenant({ id: "t3", slug: "broken", status: "failed" }),
    ])
    renderPage()

    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(nav.replace).not.toHaveBeenCalled()
    expect(screen.getByText("acme")).toBeInTheDocument()
    expect(screen.getByText("pilot-team")).toBeInTheDocument()
    expect(screen.getByText("Ready")).toBeInTheDocument()
    expect(screen.getByText("Provisioning")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getAllByText("v0.4.2")).toHaveLength(2)
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.getByText("lead@example.com")).toBeInTheDocument()
    // The URL is derived from the slug when the API hasn't set one yet.
    expect(
      screen.getByRole("link", { name: /pilot-team\.qm\.superserve\.ai/ }),
    ).toHaveAttribute("href", "https://pilot-team.qm.superserve.ai")
    // One live stack per team: creation is not offered alongside a table.
    expect(
      screen.queryByRole("link", { name: /new stack/i }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByText("pilot-team"))
    expect(nav.push).toHaveBeenCalledWith("/qm/t2")
  })

  it("filters the table by search", async () => {
    mockList.mockResolvedValue([
      qmTenant({ id: "t1", slug: "acme" }),
      qmTenant({ id: "t2", slug: "pilot-team" }),
    ])
    renderPage()
    await screen.findByRole("table")

    await userEvent.type(screen.getByRole("textbox"), "pilot")
    expect(screen.queryByText("acme")).not.toBeInTheDocument()
    expect(screen.getByText("pilot-team")).toBeInTheDocument()
  })
})
