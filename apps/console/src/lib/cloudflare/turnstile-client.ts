export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY
export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

const TURNSTILE_LOAD_TIMEOUT_MS = 1500
const TURNSTILE_TOKEN_TIMEOUT_MS = 3000

/**
 * Returns a Turnstile token for the sign-up observation, or undefined when no
 * site key is set or the widget did not answer in time. The page must load
 * `TURNSTILE_SCRIPT_SRC`.
 */
export const getTurnstileToken = async (): Promise<string | undefined> => {
  if (!TURNSTILE_SITE_KEY) return undefined
  const start = Date.now()
  while (!window.turnstile && Date.now() - start < TURNSTILE_LOAD_TIMEOUT_MS)
    await new Promise((resolve) => setTimeout(resolve, 100))
  if (!window.turnstile) return undefined
  return new Promise((resolve) => {
    const container = document.createElement("div")
    container.style.position = "fixed"
    container.style.bottom = "16px"
    container.style.right = "16px"
    container.style.zIndex = "50"
    document.body.appendChild(container)
    let widgetId = ""
    const cleanup = () => {
      if (widgetId) window.turnstile?.remove(widgetId)
      container.remove()
    }
    const deadline = setTimeout(() => {
      cleanup()
      resolve(undefined)
    }, TURNSTILE_TOKEN_TIMEOUT_MS)
    try {
      widgetId = window.turnstile!.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "compact",
        appearance: "interaction-only",
        callback: (token: string) => {
          clearTimeout(deadline)
          cleanup()
          resolve(token)
        },
        "error-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
        "timeout-callback": () => {
          clearTimeout(deadline)
          cleanup()
          resolve(undefined)
        },
      })
    } catch {
      clearTimeout(deadline)
      cleanup()
      resolve(undefined)
    }
  })
}
