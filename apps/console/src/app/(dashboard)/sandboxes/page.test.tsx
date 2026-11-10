import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ total: 0 }))

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
    useSandboxesPage: () => ({
      data: { items: [], total: state.total },
      isPending: false,
      error: null,
      refetch: vi.fn(),
      isPlaceholderData: false,
    }),
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
  state.total = 0
  window.history.replaceState(null, "", "/sandboxes")
})

it("clears the status filter and search from the no-match state", async () => {
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
  view.rerender(<SandboxesPage />)
  // The empty-account state follows once the search debounce settles.
  expect(await screen.findByText("No Sandboxes")).toBeInTheDocument()
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
