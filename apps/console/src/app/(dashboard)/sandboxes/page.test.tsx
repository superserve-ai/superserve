import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import { useSandboxesPage } from "@/hooks/use-sandboxes"
import type { SandboxListItem } from "@/lib/api/types"

const state = vi.hoisted(() => ({
  items: [] as SandboxListItem[],
  total: 0,
  isPlaceholderData: false,
  error: null as Error | null,
}))

// useListParams writes the URL with history.replaceState; read it back the
// same way Next would.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))
vi.mock("@/hooks/use-create-param", () => ({
  useCreateParam: () => [false, vi.fn()],
}))
vi.mock("@/hooks/use-sandboxes", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn() })
  return {
    useSandboxesPage: vi.fn(() => ({
      data: { items: state.items, total: state.total },
      isPending: false,
      error: state.error,
      refetch: vi.fn(),
      isPlaceholderData: state.isPlaceholderData,
    })),
    useDeleteSandbox: mutation,
    useBulkDeleteSandboxes: mutation,
    usePauseSandbox: mutation,
    useResumeSandbox: mutation,
  }
})
vi.mock("@/components/sandboxes/create-sandbox-dialog", () => ({
  CreateSandboxDialog: () => null,
}))

import SandboxesPage from "./page"

beforeEach(() => {
  vi.clearAllMocks()
  state.items = []
  state.total = 0
  state.isPlaceholderData = false
  state.error = null
  window.history.replaceState(null, "", "/sandboxes")
})

it("clears filters and keeps search focused after the unfiltered results settle", async () => {
  window.history.replaceState(
    null,
    "",
    "/sandboxes?status=paused&q=web&sort=name&size=20&page=2",
  )
  const view = render(<SandboxesPage />)

  expect(screen.getByText("No sandboxes match")).toBeInTheDocument()
  expect(
    screen.getByText(
      "No sandbox matches this search or status. Clear the filters to see all sandboxes.",
    ),
  ).toBeInTheDocument()
  const clearFilters = screen.getByRole("button", { name: "Clear filters" })
  clearFilters.focus()
  fireEvent.click(clearFilters)

  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Search sandboxes..." }),
  )

  // The filters go and paging restarts; sort and page size stay.
  expect(window.location.search).toBe("?sort=name&size=20")
  state.isPlaceholderData = true
  view.rerender(<SandboxesPage />)
  await waitFor(() => {
    expect(useSandboxesPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined, status: undefined }),
    )
  })

  state.items = [
    {
      id: "sbx-123",
      name: "example-sandbox",
      status: "active",
      vcpu_count: 2,
      memory_mib: 1024,
      metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  ]
  state.total = 1
  state.isPlaceholderData = false
  view.rerender(<SandboxesPage />)

  expect(
    screen.getByRole("link", { name: "example-sandbox" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole("textbox", { name: "Search sandboxes..." }),
  ).toHaveFocus()

  state.items = []
  state.total = 0
  view.rerender(<SandboxesPage />)
  expect(
    screen.getByRole("button", { name: "Create Sandbox" }),
  ).not.toHaveFocus()
})

it("focuses Create Sandbox when clearing filters settles on an empty account", async () => {
  window.history.replaceState(null, "", "/sandboxes?status=paused&q=web")
  const view = render(<SandboxesPage />)
  const clearFilters = screen.getByRole("button", { name: "Clear filters" })
  clearFilters.focus()
  fireEvent.click(clearFilters)

  const search = screen.getByRole("textbox", { name: "Search sandboxes..." })
  expect(search).toHaveFocus()
  view.rerender(<SandboxesPage />)
  expect(screen.queryByText("No Sandboxes")).not.toBeInTheDocument()
  expect(search).toHaveFocus()

  state.isPlaceholderData = true
  view.rerender(<SandboxesPage />)
  await waitFor(() => {
    expect(useSandboxesPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined, status: undefined }),
    )
  })
  expect(screen.queryByText("No Sandboxes")).not.toBeInTheDocument()
  expect(search).toHaveFocus()

  state.isPlaceholderData = false
  view.rerender(<SandboxesPage />)

  expect(screen.getByText("No Sandboxes")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Create Sandbox" })).toHaveFocus()
  expect(search).not.toBeInTheDocument()
})

it("does not move focus on the initial load of an empty account", () => {
  render(<SandboxesPage />)

  expect(
    screen.getByRole("button", { name: "Create Sandbox" }),
  ).not.toHaveFocus()
})

it("resets the clear-filters focus request when the unfiltered query errors", () => {
  window.history.replaceState(null, "", "/sandboxes?status=paused")
  const view = render(<SandboxesPage />)
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))

  state.error = new Error("Unable to load sandboxes")
  view.rerender(<SandboxesPage />)
  expect(screen.getByText("Unable to load sandboxes")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Try Again" })).not.toHaveFocus()

  state.error = null
  view.rerender(<SandboxesPage />)
  expect(
    screen.getByRole("button", { name: "Create Sandbox" }),
  ).not.toHaveFocus()
})

it("offers no clear action when no filter is set", () => {
  // Rows exist, but this page past the end is empty.
  state.total = 5
  window.history.replaceState(null, "", "/sandboxes?page=3")
  render(<SandboxesPage />)

  expect(screen.getByText("No sandboxes match")).toBeInTheDocument()
  expect(
    screen.getByText("Try a different search term or status filter."),
  ).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
})
