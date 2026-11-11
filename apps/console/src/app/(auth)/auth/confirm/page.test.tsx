import { cleanup, render, screen } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name)! } : undefined,
  }),
}))
vi.mock("next/image", () => ({ default: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}))
vi.mock("@/components/corner-brackets", () => ({ CornerBrackets: () => null }))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))

import {
  encodePendingEmailLink,
  newPendingEmailLink,
} from "@/lib/auth/email-link-confirm"

import ConfirmEmailLinkPage from "./page"

async function renderPage(search: Record<string, string> = {}) {
  render(await ConfirmEmailLinkPage({ searchParams: Promise.resolve(search) }))
}

function saveLink(query: string, name = "__Host-ss_email_link") {
  const link = newPendingEmailLink(new URLSearchParams(query))
  jar.set(name, encodePendingEmailLink(link))
  return link
}

describe("email link confirm page", () => {
  beforeEach(() => jar.clear())
  afterEach(cleanup)

  it("posts the saved CSRF value back to the callback", async () => {
    const link = saveLink("token_hash=hashed&type=recovery")

    await renderPage()

    expect(screen.getByText("Reset your password")).toBeTruthy()
    const button = screen.getByRole("button", { name: "Continue" })
    const form = button.closest("form")!
    expect(form.getAttribute("method")).toBe("post")
    expect(form.getAttribute("action")).toBe("/auth/callback/")
    const csrf = form.querySelector<HTMLInputElement>('input[name="csrf"]')!
    expect(csrf.type).toBe("hidden")
    expect(csrf.value).toBe(link.csrf)
    // The token never reaches the page.
    expect(document.body.innerHTML).not.toContain("hashed")
  })

  it("reads the local development cookie name", async () => {
    saveLink("token_hash=hashed&type=signup", "ss_email_link")

    await renderPage()

    expect(screen.getByText("Confirm your email")).toBeTruthy()
  })

  it("asks to press Continue again after a refused post", async () => {
    saveLink("token_hash=hashed&type=magiclink")

    await renderPage({ retry: "1" })

    expect(screen.getByRole("alert").textContent).toContain(
      "Press Continue again",
    )
  })

  it("asks for the email link again when no link is saved", async () => {
    await renderPage()

    expect(screen.getByText("Open your email link again")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href"),
    ).toBe("/auth/signin")
  })
})
