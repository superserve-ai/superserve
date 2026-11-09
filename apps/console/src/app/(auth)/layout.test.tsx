import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

vi.mock("@/components/fingerprint-signup-observer", () => ({
  FingerprintSignupObserver: () => null,
}))
vi.mock("@/components/account-device-recorder", () => ({
  AccountDeviceRecorder: () => null,
}))
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}))
vi.mock("next/script", () => ({ default: () => null }))
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: { signOut: vi.fn(() => Promise.resolve()) },
  }),
}))

import { PendingReview } from "@/components/auth/pending-review"

import AuthLayout from "./layout"

it("wraps auth pages in a single main landmark", () => {
  render(
    <AuthLayout>
      <h1>Sign in</h1>
    </AuthLayout>,
  )
  expect(screen.getByRole("main")).toContainElement(
    screen.getByRole("heading", { name: "Sign in" }),
  )
})

it("does not nest a second main landmark inside the pending review page", () => {
  render(
    <AuthLayout>
      <PendingReview name="Ada" email="ada@example.com" />
    </AuthLayout>,
  )
  expect(screen.getAllByRole("main")).toHaveLength(1)
})
