export const AUTH_MESSAGES = Object.freeze({
  networkError:
    "We couldn't reach Superserve. Check your connection and try again.",
  signInFailed: "We couldn't sign you in. Try again, or continue with Google.",
  googleSignInFailed:
    "We couldn't start Google sign-in. Try again, or sign in with email.",
  botCheckBlocked:
    "Our bot check didn't load. Turn off ad or content blockers for this site, then try again.",
  botCheckFailed:
    "We couldn't verify you're human. Refresh the page and try again.",
  botCheckUnavailable: "Our bot check isn't responding. Try again in a minute.",
  signInLinkFailed:
    "We couldn't send the sign-in link. Try again in a minute, or continue with Google.",
  resetEmailNetworkError:
    "We couldn't send the reset email. Check your connection and try again.",
  resetEmailFailed: "We couldn't send the reset email. Try again in a minute.",
} as const)

export function isNetworkAuthError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    return false
  }

  // Supabase returns AuthRetryableFetchError with status 0 for both rejected
  // fetches and unparseable responses, so only the browser's fetch-failure
  // message identifies a network error.
  return /^(?:TypeError: )?(?:Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed|The network connection was lost\.|The Internet connection appears to be offline\.|fetch failed)$/i.test(
    error.message.trim(),
  )
}
