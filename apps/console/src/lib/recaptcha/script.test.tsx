/**
 * RecaptchaScript — the one loader for the reCAPTCHA script on auth pages.
 * Next.js calls only the first loader's onError for a script src, so each
 * loader must record a failure for getRecaptchaToken to see it.
 */

import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const scriptProps = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock("next/script", () => ({
  default: (props: Record<string, unknown>) => {
    scriptProps.push(props)
    return null
  },
}))

// The site key is read when the module loads, so import it after stubbing.
async function load(siteKey: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_RECAPTCHA_SITE_KEY", siteKey)
  vi.resetModules()
  const [script, client] = await Promise.all([
    import("./script"),
    import("./client"),
  ])
  return { ...script, ...client }
}

describe("RecaptchaScript", () => {
  afterEach(() => {
    cleanup()
    scriptProps.length = 0
    vi.unstubAllEnvs()
    delete (window as { grecaptcha?: unknown }).grecaptcha
  })

  it("loads the Enterprise script for the site key", async () => {
    const { RecaptchaScript } = await load("site-key")
    render(<RecaptchaScript />)
    expect(scriptProps).toHaveLength(1)
    expect(scriptProps[0]).toMatchObject({
      src: "https://www.google.com/recaptcha/enterprise.js?render=site-key",
      strategy: "afterInteractive",
    })
  })

  it("renders nothing without a site key", async () => {
    const { RecaptchaScript } = await load(undefined)
    render(<RecaptchaScript />)
    expect(scriptProps).toHaveLength(0)
  })

  it("makes a load error end getRecaptchaToken at once", async () => {
    const { RecaptchaScript, getRecaptchaToken } = await load("site-key")
    render(<RecaptchaScript />)
    const onError = scriptProps[0]?.onError as () => void
    expect(typeof onError).toBe("function")
    onError()
    vi.useFakeTimers()
    try {
      const pending = getRecaptchaToken("signin")
      let settled = false
      void pending.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
