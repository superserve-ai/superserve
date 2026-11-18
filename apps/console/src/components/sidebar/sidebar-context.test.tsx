import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import {
  SidebarProvider,
  SMALL_SCREEN_MEDIA_QUERY,
  useSidebar,
} from "./sidebar-context"

const navigation = vi.hoisted(() => ({ pathname: "/sandboxes" }))
const STORAGE_KEY = "superserve-sidebar-collapsed"

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}))

function mockMatchMedia(matches: boolean) {
  const mediaQuery = Object.assign(new EventTarget(), { matches })
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQuery),
  )

  return (nextMatches: boolean) => {
    mediaQuery.matches = nextMatches
    mediaQuery.dispatchEvent(
      Object.assign(new Event("change"), { matches: nextMatches }),
    )
  }
}

function SidebarState() {
  const { isCollapsed, isOverlayOpen, toggle } = useSidebar()

  return (
    <>
      <output data-overlay-open={String(isOverlayOpen)}>
        {isCollapsed ? "collapsed" : "expanded"}
      </output>
      <button type="button" onClick={toggle}>
        Toggle sidebar
      </button>
    </>
  )
}

beforeEach(() => {
  navigation.pathname = "/sandboxes"
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it("starts collapsed on small screens without a stored preference", () => {
  mockMatchMedia(true)
  render(<SidebarState />, { wrapper: SidebarProvider })

  expect(screen.getByRole("status")).toHaveTextContent("collapsed")
})

it("starts collapsed on small screens with an expanded desktop preference", () => {
  mockMatchMedia(true)
  localStorage.setItem(STORAGE_KEY, "false")
  render(<SidebarState />, { wrapper: SidebarProvider })

  expect(screen.getByRole("status")).toHaveTextContent("collapsed")
})

it("expands on small screens without writing the desktop preference", () => {
  mockMatchMedia(true)
  localStorage.setItem(STORAGE_KEY, "true")
  render(<SidebarState />, { wrapper: SidebarProvider })

  fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }))

  expect(screen.getByRole("status")).toHaveTextContent("expanded")
  expect(localStorage.getItem(STORAGE_KEY)).toBe("true")
})

it("reports an open overlay only on small screens while expanded", () => {
  const setMatches = mockMatchMedia(true)
  render(<SidebarState />, { wrapper: SidebarProvider })
  const status = screen.getByRole("status")
  const toggle = screen.getByRole("button", { name: "Toggle sidebar" })
  expect(status).toHaveAttribute("data-overlay-open", "false")

  fireEvent.click(toggle)
  expect(status).toHaveAttribute("data-overlay-open", "true")

  act(() => setMatches(false))
  expect(status).toHaveTextContent("expanded")
  expect(status).toHaveAttribute("data-overlay-open", "false")
})

it("closes the expanded sidebar on small screens when the pathname changes", () => {
  mockMatchMedia(true)
  localStorage.setItem(STORAGE_KEY, "true")
  const { rerender } = render(<SidebarState />, { wrapper: SidebarProvider })

  fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }))
  expect(screen.getByRole("status")).toHaveTextContent("expanded")

  navigation.pathname = "/templates"
  rerender(<SidebarState />)

  expect(screen.getByRole("status")).toHaveTextContent("collapsed")
})

it("starts expanded on desktop without a stored preference", () => {
  mockMatchMedia(false)
  render(<SidebarState />, { wrapper: SidebarProvider })

  expect(screen.getByRole("status")).toHaveTextContent("expanded")
})

it("honors the collapsed desktop preference and persists a desktop toggle", () => {
  mockMatchMedia(false)
  localStorage.setItem(STORAGE_KEY, "true")
  render(<SidebarState />, { wrapper: SidebarProvider })

  expect(screen.getByRole("status")).toHaveTextContent("collapsed")
  fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }))
  expect(screen.getByRole("status")).toHaveTextContent("expanded")
  expect(localStorage.getItem(STORAGE_KEY)).toBe("false")
})

it("collapses when the viewport crosses from desktop to small", () => {
  const setMatches = mockMatchMedia(false)
  render(<SidebarState />, { wrapper: SidebarProvider })
  expect(screen.getByRole("status")).toHaveTextContent("expanded")

  act(() => setMatches(true))

  expect(screen.getByRole("status")).toHaveTextContent("collapsed")
  expect(SMALL_SCREEN_MEDIA_QUERY).toBe("(width < 48rem)")
  expect(window.matchMedia).toHaveBeenCalledWith(SMALL_SCREEN_MEDIA_QUERY)
})

it.each([
  { preference: null, desktopState: "expanded" },
  { preference: "true", desktopState: "collapsed" },
])(
  "clears the mobile expansion after switching to $desktopState desktop and back",
  ({ preference, desktopState }) => {
    const setMatches = mockMatchMedia(true)
    if (preference !== null) localStorage.setItem(STORAGE_KEY, preference)
    render(<SidebarState />, { wrapper: SidebarProvider })

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }))
    expect(screen.getByRole("status")).toHaveTextContent("expanded")
    expect(localStorage.getItem(STORAGE_KEY)).toBe(preference)

    act(() => setMatches(false))
    expect(screen.getByRole("status")).toHaveTextContent(desktopState)

    act(() => setMatches(true))
    expect(screen.getByRole("status")).toHaveTextContent("collapsed")
  },
)
