/**
 * Shared test mocks for the console.
 *
 * Import these from test files to avoid re-declaring the same stubs in
 * every file. Each helper returns an object so tests can access and reset
 * individual mock functions.
 *
 * Usage:
 *   import { mockUIModule, mockNextNav, mockSupabase, mockPostHog } from "@/test/mocks"
 *   mockUIModule()
 *   const nav = mockNextNav({ next: "/sandboxes" })
 *   nav.push.mockClear()
 */

import type React from "react"
import { vi } from "vitest"

// --------- @superserve/ui ---------

/**
 * Mock @superserve/ui with the pieces most pages need: `cn`, `Button`,
 * `Input` (renders its error prop), and a no-op `useToast`. The returned
 * `addToast` spy lets tests assert toast calls.
 */
export function mockUIModule() {
  const addToast = vi.fn()
  vi.mock("@superserve/ui", () => ({
    cn: (...classes: Array<string | undefined | false | null>) =>
      classes.filter(Boolean).join(" "),
    useToast: () => ({ addToast }),
    Button: (props: React.JSX.IntrinsicElements["button"]) => (
      <button type="button" {...props} />
    ),
    Input: ({
      suffix,
      error,
      wrapperClassName: _wrapperClassName,
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
  return { addToast }
}

// --------- next/navigation ---------

interface NavMock {
  push: ReturnType<typeof vi.fn>
  replace: ReturnType<typeof vi.fn>
  back: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  params: Record<string, string>
  searchParams: Record<string, string>
}

/**
 * Mock next/navigation's useRouter / useSearchParams / useParams.
 * `initialSearchParams` and `initialParams` are mutated in place, so tests
 * can change them between renders.
 */
export function mockNextNav(
  initialSearchParams: Record<string, string> = {},
  initialParams: Record<string, string> = {},
): NavMock {
  const push = vi.fn()
  const replace = vi.fn()
  const back = vi.fn()
  const refresh = vi.fn()
  const searchParams = { ...initialSearchParams }
  const params = { ...initialParams }

  vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace, back, refresh }),
    useSearchParams: () => ({
      get: (key: string) => searchParams[key] ?? null,
      toString: () => new URLSearchParams(searchParams).toString(),
    }),
    useParams: () => params,
    usePathname: () => "/",
  }))

  return { push, replace, back, refresh, params, searchParams }
}

// --------- next/link + next/image ---------

export function mockNextLink() {
  vi.mock("next/link", () => ({
    default: ({
      children,
      href,
      ...rest
    }: {
      children: React.ReactNode
      href: string
    }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  }))
}

export function mockNextImage() {
  vi.mock("next/image", () => ({
    default: ({ alt, src }: { alt: string; src: string }) => (
      <img alt={alt} src={src} />
    ),
  }))
}

// --------- @superserve/supabase ---------

export function mockSupabase(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signInWithPassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: null }),
    updateUser: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    ...overrides,
  }
  vi.mock("@superserve/supabase", () => ({
    createBrowserClient: () => ({ auth }),
  }))
  return { auth }
}

// --------- posthog-js/react ---------

export function mockPostHog() {
  const capture = vi.fn()
  const identify = vi.fn()
  const reset = vi.fn()
  const register_once = vi.fn()
  vi.mock("posthog-js/react", () => ({
    usePostHog: () => ({ capture, identify, reset, register_once }),
  }))
  return { capture, identify, reset, register_once }
}

// --------- Decorative components ---------

/** Stubs the CornerBrackets + DitherBackground decorative components. */
export function mockDecorations() {
  vi.mock("@/components/corner-brackets", () => ({
    CornerBrackets: () => null,
  }))
  vi.mock("@/components/dither-background", () => ({
    DitherBackground: () => null,
  }))
  vi.mock("@/components/icons", () => ({
    GoogleIcon: () => <span>GoogleIcon</span>,
    Spinner: ({ className }: { className?: string }) => (
      <div className={className}>spinner</div>
    ),
  }))
}

// --------- @phosphor-icons/react ---------

/**
 * Generic phosphor icon mock — returns a span for every named icon. If a
 * test needs a specific icon to be distinguishable, pass it via `only`.
 */
export function mockPhosphorIcons() {
  vi.mock("@phosphor-icons/react", () => {
    const handler = {
      get: (_target: object, prop: string) => {
        if (prop === "default") return undefined
        return () => <span>{prop}</span>
      },
    }
    return new Proxy({}, handler)
  })
}
