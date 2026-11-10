export const AUTH_MESSAGES = Object.freeze({
  networkError:
    "We couldn't reach Superserve. Check your connection and try again.",
  signInFailed: "We couldn't sign you in. Try again, or use a sign-in link.",
  googleSignInFailed:
    "We couldn't start Google sign-in. Try again, or sign in with email.",
  botCheckBlocked:
    "Our bot check didn't load. Turn off ad or content blockers for this site, then try again.",
  botCheckFailed:
    "We couldn't verify you're human. Refresh the page and try again.",
  botCheckUnavailable: "Our bot check isn't responding. Try again in a minute.",
  signInLinkFailed:
    "We couldn't send the sign-in link. Try again in a minute, or continue with Google.",
  resetEmailFailed:
    "We couldn't send the reset email. Check your connection and try again.",
} as const)

export function isNetworkAuthError(
  error:
    | { name?: string; status?: number; message?: string }
    | null
    | undefined,
): boolean {
  // Supabase uses status 0 for rejected fetches; gateway errors reuse the class with HTTP statuses.
  return (
    (error?.name === "AuthRetryableFetchError" && error.status === 0) ||
    /^(Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed)$/i.test(
      error?.message ?? "",
    )
  )
}
