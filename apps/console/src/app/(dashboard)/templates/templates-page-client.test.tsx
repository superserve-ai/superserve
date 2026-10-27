import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  status: "unavailable",
  query: "",
  search: "",
  open: false,
  setOpen: vi.fn(),
  retry: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock("@/hooks/use-create-param", () => ({
  useCreateParam: () => [state.open, state.setOpen],
}))
vi.mock("@/hooks/use-template-entitlement", () => ({
  useTemplateEntitlement: () => ({ status: state.status, retry: state.retry }),
}))
vi.mock("@/hooks/use-list-params", () => ({
  useListParams: () => ({
    page: 1,
    pageSize: 20,
    sort: "created_at",
    order: "desc",
    q: state.search,
    debouncedQ: state.search,
    setParam: vi.fn(),
    toggleSort: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    setSearch: vi.fn(),
  }),
}))
vi.mock("@/hooks/use-templates", () => ({
  useTemplatesPage: () => ({
    data: { items: [], total: 0 },
    isPending: false,
    error: null,
    isPlaceholderData: false,
  }),
}))
vi.mock("@/components/templates/create-template-dialog", () => ({
  CreateTemplateDialog: () => null,
}))
import TemplatesPageClient from "./templates-page-client"
beforeEach(() => {
  state.status = "unavailable"
  state.query = ""
  state.search = ""
  state.open = false
  state.setOpen.mockReset()
  state.retry.mockReset()
})
it.each(["", "owner=team", "owner=system"])(
  "offers upgrade without any creation action on a zero-cap page (%s)",
  (query) => {
    state.query = query
    render(<TemplatesPageClient />)
    expect(
      screen.getByRole("link", { name: "Upgrade to create templates" }),
    ).toHaveAttribute("href", "/plan-usage/upgrade")
    expect(screen.queryByRole("button", { name: "Create template" })).toBeNull()
    expect(state.setOpen).not.toHaveBeenCalled()
  },
)
it("hides empty search creation and retries failed entitlement without opening creation", () => {
  state.query = "owner=team"
  state.search = "not-found"
  state.status = "error"
  render(<TemplatesPageClient />)
  fireEvent.click(screen.getByRole("button", { name: "Retry template limits" }))
  expect(state.retry).toHaveBeenCalledOnce()
  expect(screen.queryByRole("button", { name: "Create template" })).toBeNull()
  expect(state.setOpen).not.toHaveBeenCalled()
})
it("disables creation while loading and retains the positive-cap toolbar action", () => {
  state.status = "loading"
  const view = render(<TemplatesPageClient />)
  expect(
    screen.getByRole("button", { name: "Loading template limits…" }),
  ).toBeDisabled()
  state.status = "allowed"
  view.rerender(<TemplatesPageClient />)
  fireEvent.click(screen.getAllByRole("button", { name: "Create template" })[0])
  expect(state.setOpen).toHaveBeenCalledWith(true)
})
