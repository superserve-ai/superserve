import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { DashboardShell } from "./dashboard-shell"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/sandboxes",
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/components/sidebar/team-switcher", () => ({
  TeamSwitcher: () => null,
}))
vi.mock("@/components/sidebar/sidebar-user-menu", () => ({
  SidebarUserMenu: () => null,
}))
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "user-1" } }),
}))
vi.mock("@/hooks/use-favicon-status", () => ({ useFaviconStatus: () => {} }))
vi.mock("@/hooks/use-posthog-identify", () => ({
  usePostHogIdentify: () => {},
}))

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => Object.assign(new EventTarget(), { matches })),
  )
}

function getScrim() {
  return screen
    .getByRole("main")
    .parentElement!.querySelector(':scope > [aria-hidden="true"]')
}

function openSmallScreenSidebar() {
  mockMatchMedia(true)
  render(
    <DashboardShell globalBanner={<div>Trial</div>}>
      <button type="button">Page action</button>
    </DashboardShell>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }))
}

beforeEach(() => {
  mockMatchMedia(false)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it("places one global banner above the positioned sidebar row and preserves impersonation", () => {
  render(
    <DashboardShell
      globalBanner={<div>Trial</div>}
      banner={<div>Impersonation</div>}
    >
      <div>Page</div>
    </DashboardShell>,
  )
  const main = screen.getByRole("main")
  const row = main.parentElement!
  expect(row).toHaveClass("relative", "min-h-0")
  expect(row).toContainElement(screen.getByRole("complementary"))
  expect(row).not.toContainElement(screen.getByText("Trial"))
  expect(row.previousElementSibling).toContainElement(screen.getByText("Trial"))
  expect(main).toContainElement(screen.getByText("Impersonation"))
  expect(main).toContainElement(screen.getByText("Page"))
  expect(screen.getAllByText("Trial")).toHaveLength(1)
})

it("uses the rail margin on small screens and the wider desktop margin only when expanded", () => {
  render(<DashboardShell>Page</DashboardShell>)

  expect(screen.getByRole("main")).toHaveClass("ml-16", "md:ml-64")
  expect(screen.getByRole("main")).not.toHaveClass("ml-64")

  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))

  expect(screen.getByRole("main")).toHaveClass("ml-16")
  expect(screen.getByRole("main")).not.toHaveClass("md:ml-64")
})

it("disables the main transition for reduced motion", () => {
  render(<DashboardShell>Page</DashboardShell>)

  expect(screen.getByRole("main")).toHaveClass("motion-reduce:transition-none")
})

it("shows a scrim in the sidebar row and collapses the phone overlay when clicked", () => {
  openSmallScreenSidebar()

  const scrim = getScrim()
  expect(scrim).toHaveClass(
    "absolute",
    "inset-0",
    "z-30",
    "bg-background/60",
    "md:hidden",
  )
  expect(scrim).not.toContainElement(screen.getByText("Trial"))

  fireEvent.click(scrim!)

  expect(
    screen.getByRole("button", { name: "Expand sidebar" }),
  ).toBeInTheDocument()
  expect(getScrim()).toBeNull()
})

it("makes main inert only while the phone overlay is open", () => {
  openSmallScreenSidebar()
  const main = screen.getByRole("main", { hidden: true })
  expect(main).toHaveAttribute("inert")

  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))

  expect(main).not.toHaveAttribute("inert")
})

it("closes the phone overlay on Escape and returns focus to the toggle", () => {
  openSmallScreenSidebar()
  const toggle = screen.getByRole("button", { name: "Collapse sidebar" })
  const search = screen.getByRole("button", { name: /Search/ })
  search.focus()
  expect(search).toHaveFocus()

  fireEvent.keyDown(search, { key: "Escape" })

  expect(screen.getByRole("button", { name: "Expand sidebar" })).toBe(toggle)
  expect(toggle).toHaveFocus()
})

it("keeps the phone overlay open when Escape is prevented", () => {
  openSmallScreenSidebar()
  const search = screen.getByRole("button", { name: /Search/ })
  search.focus()
  search.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  })

  expect(fireEvent.keyDown(search, { key: "Escape" })).toBe(false)

  expect(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeInTheDocument()
  expect(search).toHaveFocus()
})

it("keeps the phone overlay open when Escape dismisses the command palette", async () => {
  openSmallScreenSidebar()
  fireEvent.click(screen.getByRole("button", { name: /Search/ }))
  const input = screen.getByPlaceholderText("Type a command or search...")

  fireEvent.keyDown(input, { key: "Escape" })

  await waitFor(() => expect(input).not.toBeInTheDocument())
  expect(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeInTheDocument()
})

it("keeps the expanded desktop sidebar non-modal and ignores Escape", () => {
  const writePreference = vi.spyOn(localStorage, "setItem")
  render(
    <DashboardShell>
      <button type="button">Page action</button>
    </DashboardShell>,
  )

  expect(getScrim()).toBeNull()
  expect(screen.getByRole("main")).not.toHaveAttribute("inert")
  const pageAction = screen.getByRole("button", { name: "Page action" })
  pageAction.focus()

  fireEvent.keyDown(pageAction, { key: "Escape" })

  expect(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeInTheDocument()
  expect(pageAction).toHaveFocus()
  expect(writePreference).not.toHaveBeenCalled()
})
