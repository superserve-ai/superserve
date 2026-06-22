/**
 * PreviewSection — the per-sandbox preview surface.
 *
 * Covers the status gate, the multi-port add/validate/remove flow, copy,
 * the safe open-in-new-tab link + analytics, and the on-demand iframe.
 * URLs use the test host from src/test/setup.ts (sandbox.test.superserve.ai).
 */

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxResponse } from "@/lib/api/types"

const { addToast, capture, clipboardWrite } = vi.hoisted(() => ({
  addToast: vi.fn(),
  capture: vi.fn(),
  clipboardWrite: vi.fn(() => Promise.resolve()),
}))

vi.mock("@superserve/ui", () => ({
  Alert: ({ children }: { children?: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button type="button" {...props} />
  ),
  // Force a text input: the component reads the draft as a string regardless,
  // and happy-dom's number input drops below-`min` values (a JSDOM-ish quirk
  // that doesn't happen in a real browser, where `min` doesn't block typing).
  Input: (props: React.JSX.IntrinsicElements["input"]) => (
    <input {...props} type="text" />
  ),
  useToast: () => ({ addToast }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture }),
}))

// Icons render nothing so accessible names come from text / aria-label only.
vi.mock("@phosphor-icons/react", () => ({
  ArrowSquareOutIcon: () => null,
  BrowserIcon: () => null,
  CaretRightIcon: () => null,
  CopyIcon: () => null,
  PlusIcon: () => null,
  TrashIcon: () => null,
}))

import { PreviewSection } from "./preview-section"

// happy-dom would otherwise fetch the iframe `src` and log an aborted-fetch
// NetworkError during cleanup; we assert on attributes, not loaded content.
const happyDOM = (
  globalThis as {
    happyDOM?: { settings: { disableIframePageLoading: boolean } }
  }
).happyDOM
if (happyDOM) {
  happyDOM.settings.disableIframePageLoading = true
}

const HOST = "sandbox.test.superserve.ai" // set in src/test/setup.ts

function makeSandbox(
  status: SandboxResponse["status"] = "active",
  id = "sbx-1",
): SandboxResponse {
  return {
    id,
    name: "my-box",
    status,
    vcpu_count: 2,
    memory_mib: 512,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    access_token: "tok",
  }
}

function url(port: number, id = "sbx-1"): string {
  return `https://${port}-${id}.${HOST}`
}

beforeEach(() => {
  window.localStorage.clear()
  addToast.mockClear()
  capture.mockClear()
  clipboardWrite.mockClear()
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
    writable: true,
  })
})

async function addPort(
  user: ReturnType<typeof userEvent.setup>,
  port: string,
): Promise<void> {
  await user.type(screen.getByLabelText("Port to preview"), port)
  await user.click(screen.getByRole("button", { name: /add port/i }))
}

describe("PreviewSection — inactive sandbox", () => {
  const user = userEvent.setup()

  it("shows an empty state and offers Start for a paused sandbox", async () => {
    const onStart = vi.fn()
    render(<PreviewSection sandbox={makeSandbox("paused")} onStart={onStart} />)

    expect(screen.getByText("No preview available")).toBeInTheDocument()
    expect(screen.queryByLabelText("Port to preview")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Start sandbox" }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("does not offer Start for a failed sandbox", () => {
    render(<PreviewSection sandbox={makeSandbox("failed")} />)
    expect(screen.getByText("No preview available")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start sandbox" }),
    ).not.toBeInTheDocument()
  })
})

describe("PreviewSection — active sandbox", () => {
  const user = userEvent.setup()

  it("shows the add-port form and an empty-list prompt", () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    expect(screen.getByLabelText("Port to preview")).toBeInTheDocument()
    expect(
      screen.getByText(/add the port your dev server runs on/i),
    ).toBeInTheDocument()
  })

  it("adds a port and renders its preview URL", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    expect(screen.getByText(url(3000))).toBeInTheDocument()
    expect(screen.getByText(":3000")).toBeInTheDocument()
  })

  it("rejects an invalid (privileged) port with a toast and adds nothing", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "80")
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining("between"),
      "error",
    )
    expect(screen.queryByText(url(80))).not.toBeInTheDocument()
  })

  it("rejects a duplicate port with a toast and keeps a single row", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await addPort(user, "3000")
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining("already added"),
      "error",
    )
    expect(screen.getAllByText(url(3000))).toHaveLength(1)
  })

  it("copies the preview URL to the clipboard", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await user.click(screen.getByRole("button", { name: "Copy preview URL" }))
    expect(clipboardWrite).toHaveBeenCalledWith(url(3000))
    expect(addToast).toHaveBeenCalledWith("Preview URL copied", "success")
  })

  it("exposes a safe open-in-new-tab link and tracks the open", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")

    const link = screen.getByRole("link", { name: "Open preview in new tab" })
    expect(link).toHaveAttribute("href", url(3000))
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")

    await user.click(link)
    expect(capture).toHaveBeenCalledWith("sandbox_preview_opened", {
      sandbox_id: "sbx-1",
      port: 3000,
    })
  })

  it("removes a port", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await user.click(screen.getByRole("button", { name: "Remove port 3000" }))
    expect(screen.queryByText(url(3000))).not.toBeInTheDocument()
  })

  it("mounts the iframe only when a row is expanded", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    expect(screen.queryByTitle("Preview of port 3000")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Expand preview" }))
    const frame = screen.getByTitle("Preview of port 3000")
    expect(frame).toHaveAttribute("src", url(3000))

    // The framed app is untrusted: it must be sandboxed, and must NOT be able
    // to navigate the console's top-level tab (phishing). This fails if anyone
    // drops the sandbox attribute or grants top-navigation.
    const sandboxAttr = frame.getAttribute("sandbox") ?? ""
    expect(sandboxAttr).toContain("allow-scripts")
    expect(sandboxAttr).not.toContain("allow-top-navigation")
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
  })

  it("supports previewing several ports at once", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await addPort(user, "8080")
    expect(screen.getByText(url(3000))).toBeInTheDocument()
    expect(screen.getByText(url(8080))).toBeInTheDocument()
  })
})
