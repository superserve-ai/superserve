export const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u0020\u007f]/
export const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/

const RELATIVE_REDIRECT_ORIGIN = "https://console.invalid"

function safeRelativePath(path: string): string {
  return path.startsWith("/") &&
    !path.startsWith("//") &&
    !UNSAFE_PATH_CHARACTERS.test(path)
    ? path
    : "/"
}

/** Validates auth redirects because the URL parser treats `\` as `/` and strips tabs and newlines. */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/"
  if (!raw.startsWith("/")) {
    return TRUSTED_REDIRECT_PATTERN.test(raw) &&
      !UNSAFE_PATH_CHARACTERS.test(raw)
      ? raw
      : "/"
  }

  try {
    let path = raw
    for (let round = 0; ; round++) {
      if (safeRelativePath(path) !== path) return "/"
      if (!path.includes("%")) break
      if (round === 5) return "/"
      path = decodeURIComponent(path)
    }
    return new URL(raw, RELATIVE_REDIRECT_ORIGIN).origin ===
      RELATIVE_REDIRECT_ORIGIN
      ? raw
      : "/"
  } catch {
    return "/"
  }
}
