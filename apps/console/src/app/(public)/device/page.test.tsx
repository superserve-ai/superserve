import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  oauth: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("@/app/(auth)/auth/signin/google-action", () => ({
  beginGoogleSignIn: mocks.begin,
}))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: mocks.oauth,
    },
  }),
}))
vi.mock("@superserve/ui", () => ({
  Button: ({
    variant: _variant,
    ...props
  }: React.JSX.IntrinsicElements["button"] & { variant?: string }) => (
    <button {...props} />
  ),
  useToast: () => ({ addToast: mocks.toast }),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ code: "ABCD+1234" }),
}))
vi.mock("posthog-js/react", () => ({ usePostHog: () => null }))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/icons", () => ({
  GoogleIcon: () => null,
  Spinner: () => null,
}))

import DevicePage from "./page"

describe("device Google sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.oauth.mockResolvedValue({ error: null })
  })

  it("retains the origin before OAuth and preserves the device return code", async () => {
    let release!: (intent: string) => void
    mocks.begin.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve
      }),
    )
    render(<DevicePage />)
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    )
    expect(mocks.begin).toHaveBeenCalledOnce()
    expect(mocks.oauth).not.toHaveBeenCalled()
    release("device-origin")
    await waitFor(() => expect(mocks.oauth).toHaveBeenCalledOnce())
    const options = mocks.oauth.mock.calls[0][0]
    expect(options.provider).toBe("google")
    const callback = new URL(options.options.redirectTo)
    expect(callback.pathname).toBe("/auth/callback")
    expect(callback.searchParams.get("google_signin_intent")).toBe(
      "device-origin",
    )
    expect(callback.searchParams.get("next")).toBe("/device?code=ABCD%2B1234")
  })

  it("allows sign-in when optional origin storage is unavailable", async () => {
    mocks.begin.mockResolvedValue(undefined)
    render(<DevicePage />)
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    )
    await waitFor(() => expect(mocks.oauth).toHaveBeenCalledOnce())
    const callback = new URL(mocks.oauth.mock.calls[0][0].options.redirectTo)
    expect(callback.searchParams.has("google_signin_intent")).toBe(false)
    expect(callback.searchParams.get("next")).toBe("/device?code=ABCD%2B1234")
  })
})
