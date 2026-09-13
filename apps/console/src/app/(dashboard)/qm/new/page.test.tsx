/**
 * /qm/new — qm-api allows one live stack per team, so the page sends anyone
 * who already has one to it instead of letting them fill in the form.
 */

import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { qmTenant } from "@/test/qm-fixtures"
import { createQueryClient } from "@/test/react-query"

const mockList = vi.fn()
vi.mock("@/lib/api/qm", () => ({
  listQmTenants: (...a: unknown[]) => mockList(...a),
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { email: "me@example.com" }, loading: false }),
}))
vi.mock("@/components/qm/create-tenant-form", () => ({
  CreateTenantForm: ({ defaultAdminEmail }: { defaultAdminEmail: string }) => (
    <form aria-label="create form">{defaultAdminEmail}</form>
  ),
}))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
const teamContext = vi.hoisted(() => ({ value: null as object | null }))
vi.mock("@/components/query-provider", () => ({
  useQueryScope: () => "self",
  useDashboardTeamContext: () => teamContext.value,
}))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

import NewQmTenantPage from "./page"

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <NewQmTenantPage />
    </QueryClientProvider>,
  )
}

describe("NewQmTenantPage", () => {
  beforeEach(() => {
    mockList.mockReset()
    nav.replace.mockClear()
    teamContext.value = null
  })

  it("does not offer the form while viewing another team", async () => {
    teamContext.value = { teamId: "team-b", region: "use", name: "Other" }
    mockList.mockResolvedValue([])
    renderPage()
    expect(await screen.findByRole("status")).toHaveTextContent(
      /can't be created while viewing another team/,
    )
    expect(screen.queryByRole("form")).not.toBeInTheDocument()
  })

  it("shows the form, pre-filled with the user's email, when the team has no stack", async () => {
    mockList.mockResolvedValue([qmTenant({ id: "old", status: "deleted" })])
    renderPage()
    expect(
      await screen.findByRole("form", { name: "create form" }),
    ).toHaveTextContent("me@example.com")
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("redirects to the existing stack without rendering the form", async () => {
    mockList.mockResolvedValue([qmTenant({ id: "t1", status: "provisioning" })])
    renderPage()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/qm/t1"))
    expect(screen.queryByRole("form")).not.toBeInTheDocument()
  })

  it("still shows the form when the list cannot be loaded", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByRole("form", { name: "create form" }),
    ).toBeInTheDocument()
  })
})
