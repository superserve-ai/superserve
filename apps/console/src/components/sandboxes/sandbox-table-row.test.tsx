import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxListItem } from "@/lib/api/types"

import { SandboxTableRow } from "./sandbox-table-row"

const { rowPush, linkPush } = vi.hoisted(() => ({
  rowPush: vi.fn(),
  linkPush: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: rowPush }),
}))

// Keep anchor semantics and model Next's navigation separately from the row.
vi.mock("next/link", () => ({
  default: ({ onClick, href, children, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault()
          linkPush(href)
        }
      }}
    >
      {children}
    </a>
  ),
}))

const sandbox: SandboxListItem = {
  id: "sbx-123",
  name: "example-sandbox",
  status: "active",
  vcpu_count: 2,
  memory_mib: 1024,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
}
const href = `/sandboxes/${sandbox.id}/`

function mount() {
  const onToggle = vi.fn()
  render(
    <table>
      <tbody>
        <SandboxTableRow
          sandbox={sandbox}
          selected={false}
          onToggle={onToggle}
          onConnect={vi.fn()}
          onDelete={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onOpenTerminal={vi.fn()}
          onTakeSnapshot={vi.fn()}
        />
      </tbody>
    </table>,
  )
  return { onToggle }
}

beforeEach(() => vi.clearAllMocks())

describe("SandboxTableRow accessibility", () => {
  it("exposes the sandbox name as a link without making the row interactive", () => {
    mount()

    expect(screen.getByRole("link", { name: sandbox.name })).toHaveAttribute(
      "href",
      href,
    )
    const row = screen.getByRole("row")
    expect(row).not.toHaveAttribute("tabindex")
    expect(row).not.toHaveAttribute("role")
  })

  it("allows Tab followed by Enter to navigate once through the name link", async () => {
    const user = userEvent.setup()
    mount()
    const link = screen.getByRole("link", { name: sandbox.name })

    for (let i = 0; i < 10 && document.activeElement !== link; i++) {
      await user.tab()
    }
    expect(link).toHaveFocus()

    vi.clearAllMocks()
    await user.keyboard("{Enter}")

    expect(linkPush).toHaveBeenCalledExactlyOnceWith(href)
    expect(rowPush).toHaveBeenCalledTimes(0)
  })

  it("clicks the name link without also navigating through the row", async () => {
    const user = userEvent.setup()
    mount()

    vi.clearAllMocks()
    await user.click(screen.getByRole("link", { name: sandbox.name }))

    expect(linkPush).toHaveBeenCalledExactlyOnceWith(href)
    expect(rowPush).toHaveBeenCalledTimes(0)
  })

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
    "preserves native %s clicks without navigating through the row",
    (modifier) => {
      mount()

      vi.clearAllMocks()
      const nativeBehaviorAllowed = fireEvent.click(
        screen.getByRole("link", { name: sandbox.name }),
        { button: 0, [modifier]: true },
      )

      expect(nativeBehaviorAllowed).toBe(true)
      expect(linkPush).toHaveBeenCalledTimes(0)
      expect(rowPush).toHaveBeenCalledTimes(0)
    },
  )

  it("preserves native middle clicks without navigating through the row", () => {
    mount()
    const link = screen.getByRole("link", { name: sandbox.name })
    const event = new MouseEvent("auxclick", {
      button: 1,
      bubbles: true,
      cancelable: true,
    })

    vi.clearAllMocks()
    expect(fireEvent(link, event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(linkPush).toHaveBeenCalledTimes(0)
    expect(rowPush).toHaveBeenCalledTimes(0)
  })

  it("keeps the resources cell as a mouse navigation target", async () => {
    const user = userEvent.setup()
    mount()

    vi.clearAllMocks()
    await user.click(screen.getByRole("cell", { name: "2CPU | 1024MB" }))

    expect(rowPush).toHaveBeenCalledExactlyOnceWith(href)
    expect(linkPush).toHaveBeenCalledTimes(0)
  })

  it("toggles the checkbox without navigating", async () => {
    const user = userEvent.setup()
    const { onToggle } = mount()

    vi.clearAllMocks()
    await user.click(
      screen.getByRole("checkbox", { name: `Select ${sandbox.name}` }),
    )

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(rowPush).toHaveBeenCalledTimes(0)
    expect(linkPush).toHaveBeenCalledTimes(0)
  })

  it.each(["Connect", "Stop", "Sandbox actions"])(
    "does not navigate when clicking %s in the actions cell",
    async (name) => {
      const user = userEvent.setup()
      mount()

      vi.clearAllMocks()
      await user.click(screen.getByRole("button", { name }))

      expect(rowPush).toHaveBeenCalledTimes(0)
      expect(linkPush).toHaveBeenCalledTimes(0)
    },
  )
})
