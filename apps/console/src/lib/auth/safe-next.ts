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

/**
 * Returns `next` when it stays on the console, else "/". The URL parser treats
 * `\` as `/` and drops tabs and newlines, so "/\host" or "/<tab>/host" would
 * reach another host. The path is percent-decoded and checked again because
 * it can change the host. The query and fragment are decoded only to reject
 * control characters.
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/"
  if (!raw.startsWith("/")) {
    return TRUSTED_REDIRECT_PATTERN.test(raw) &&
      !UNSAFE_PATH_CHARACTERS.test(raw)
      ? raw
      : "/"
  }
  if (safeRelativePath(raw) !== raw) return "/"

  try {
    const pathEnd = raw.search(/[?#]/)
    let path = pathEnd === -1 ? raw : raw.slice(0, pathEnd)
    for (let round = 0; ; round++) {
      if (safeRelativePath(path) !== path) return "/"
      if (!path.includes("%")) break
      if (round === 5) return "/"
      path = decodeURIComponent(path)
    }
    if (pathEnd !== -1) {
      let suffix = raw.slice(pathEnd)
      for (let round = 0; ; round++) {
        if (/[\u0000-\u001f\u007f]/.test(suffix)) return "/"
        if (!suffix.includes("%") || round === 5) break
        const decoded = suffix.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
        if (decoded === suffix) break
        suffix = decoded
      }
    }
    return new URL(raw, RELATIVE_REDIRECT_ORIGIN).origin ===
      RELATIVE_REDIRECT_ORIGIN
      ? raw
      : "/"
  } catch {
    return "/"
  }
}
