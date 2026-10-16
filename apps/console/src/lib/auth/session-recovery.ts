import { createBrowserClient } from "@/lib/supabase/client"

export type SessionRecovery = "authenticated" | "signed-out" | "unavailable"

// A backend 401 is not proof that the console session has ended. Confirm with
// Auth, and don't turn outages, rate limits, or unknown errors into logouts.
function isEndedSession(error: { name?: string; code?: string }): boolean {
  return (
    error.name === "AuthSessionMissingError" ||
    [
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "user_not_found",
      "user_banned",
    ].includes(error.code ?? "")
  )
}

let recovery: Promise<SessionRecovery> | null = null

async function checkSession(): Promise<SessionRecovery> {
  try {
    const { auth } = createBrowserClient()
    // getSession waits for initialization and refreshes an expired access
    // token using the SDK's lock. Don't force a rotation on every API 401.
    const { data, error } = await auth.getSession()
    if (error) return isEndedSession(error) ? "signed-out" : "unavailable"
    if (!data.session) return "signed-out"
    const result = await auth.getUser()
    if (result.error)
      return isEndedSession(result.error) ? "signed-out" : "unavailable"
    return result.data.user ? "authenticated" : "signed-out"
  } catch {
    return "unavailable"
  }
}

/** Share one bounded check across concurrent failing dashboard requests. */
export function recoverSession(): Promise<SessionRecovery> {
  if (typeof window === "undefined") return Promise.resolve("unavailable")
  if (!recovery) {
    recovery = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          checkSession(),
          new Promise<SessionRecovery>((resolve) => {
            timer = setTimeout(() => resolve("unavailable"), 10_000)
          }),
        ])
      } finally {
        clearTimeout(timer)
        recovery = null
      }
    })()
  }
  return recovery
}

export function redirectToSignIn(): void {
  if (typeof window === "undefined") return
  const { pathname, search, hash } = window.location
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return
  // Encode the entire relative destination, including filters and anchors.
  const next = `${pathname}${search}${hash}`
  window.location.replace(`/auth/signin?${new URLSearchParams({ next })}`)
}
