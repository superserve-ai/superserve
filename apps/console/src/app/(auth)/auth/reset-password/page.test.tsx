/**
 * reset-password — cleanup guard.
 *
 * The page schedules a delayed router.push after successful password
 * update. When the user navigates away before the timer fires, the
 * useEffect cleanup must clear the pending setTimeout so React doesn't
 * warn about updates on unmounted components.
 *
 * We test: (a) delayed redirect fires on success, (b) unmount before the
 * timer cancels the pending push.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@superserve/ui", () => ({
  cn: (...c: Array<string | undefined | false>) => c.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: ({
    suffix,
    error,
    wrapperClassName: _w,
    ...props
  }: React.JSX.IntrinsicElements["input"] & {
    suffix?: React.ReactNode
    error?: string
    wrapperClassName?: string
  }) => (
    <div>
      <input {...props} />
      {suffix}
      {error && <p>{error}</p>}
    </div>
  ),
}))

vi.mock("@/components/corner-brackets", () => ({
  CornerBrackets: () => null,
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/icons", () => ({
  Spinner: () => <span>spin</span>,
}))
vi.mock("@phosphor-icons/react", () => ({
  EyeIcon: () => <span>eye</span>,
  EyeSlashIcon: () => <span>eye-slash</span>,
}))
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

let nextPath: string | null = null
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => nextPath }),
}))

const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

const mockUpdateUser = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: { updateUser: mockUpdateUser },
  }),
}))

import ResetPasswordPage from "./page"

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    nextPath = null
    mockPush.mockReset()
    mockUpdateUser.mockReset()
    mockCapture.mockReset()
  })

  async function fillAndSubmit(value = "Password123") {
    // Suspense boundary — wait for it to resolve to the real content.
    const password = await screen.findByPlaceholderText("New Password")
    const confirm = screen.getByPlaceholderText("Confirm New Password")
    fireEvent.change(password, { target: { value } })
    fireEvent.change(confirm, { target: { value } })
    const button = screen.getByRole("button", { name: /Update Password/ })
    fireEvent.click(button)
  }

  it("captures success event and schedules redirect on successful update", async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    render(<ResetPasswordPage />)

    await fillAndSubmit()

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: "Password123" })
      expect(mockCapture).toHaveBeenCalledWith("auth_password_reset_completed")
    })

    // The redirect is scheduled for +2s — wait for it.
    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith("/auth/signin")
      },
      { timeout: 3000 },
    )
  })

  it.each([
    `/invite/ssinv_use_${"T".repeat(43)}`,
    "/sandboxes",
    "https://example.com",
  ])("keeps only a validated invite on Back to sign in (%s)", (next) => {
    nextPath = next
    render(<ResetPasswordPage />)
    const link = screen.getByRole("link", { name: "Back to sign in" })
    const isInvite = next.startsWith("/invite/ssinv_")
    expect(
      new URL(
        link.getAttribute("href")!,
        "https://console.example.com",
      ).searchParams.get("next"),
    ).toBe(isInvite ? next : null)
    expect(link.classList.contains("ph-no-capture")).toBe(isInvite)
  })

  it.each([
    `/invite/ssinv_use_${"T".repeat(43)}`,
    "/sandboxes",
    "https://example.com",
  ])("only returns to a validated invite path (%s)", async (next) => {
    nextPath = next
    mockUpdateUser.mockResolvedValue({ error: null })
    render(<ResetPasswordPage />)
    await fillAndSubmit()
    await waitFor(
      () =>
        expect(mockPush).toHaveBeenCalledWith(
          next.startsWith("/invite/") ? next : "/auth/signin",
        ),
      { timeout: 3000 },
    )
  })

  it("shows the password rule before submit", async () => {
    render(<ResetPasswordPage />)

    const password = await screen.findByPlaceholderText("New Password")
    expect(
      screen.getByText(
        "Use 8 or more characters with an uppercase letter, a lowercase letter, and a number.",
      ),
    ).toBeTruthy()
    expect(password.getAttribute("aria-describedby")).toBe(
      "reset-password-rule",
    )
  })

  it("names the missing part of a weak password without calling the server", async () => {
    render(<ResetPasswordPage />)

    await fillAndSubmit("sandbox12345")

    expect(await screen.findByText("Add an uppercase letter.")).toBeTruthy()
    expect(
      screen.queryByText(
        "Use 8 or more characters with an uppercase letter, a lowercase letter, and a number.",
      ),
    ).toBeNull()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it("rejects a password over 72 bytes without calling the server", async () => {
    render(<ResetPasswordPage />)

    await fillAndSubmit("Sandbox42".padEnd(73, "x"))

    expect(await screen.findByText("Use 72 characters or fewer.")).toBeTruthy()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it("cancels pending redirect on unmount", async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    const { unmount } = render(<ResetPasswordPage />)

    await fillAndSubmit()

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled()
    })

    // Unmount immediately before the 2s timer fires.
    unmount()

    // Wait longer than the timer would have been — router.push should NOT
    // have fired because useEffect cleanup cleared the timeout.
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
