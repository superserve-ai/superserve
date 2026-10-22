import "server-only"

// Check the literal authority before URL parsing can normalize numeric aliases.
const LOCAL_HTTP_ORIGIN =
  /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?\/?$/

export function ycBrowserOrigin(configured: string | undefined): string | null {
  if (!configured) return null
  const local = LOCAL_HTTP_ORIGIN.exec(configured)
  if (local) {
    if (local[1] && Number(local[1]) > 65535) return null
  } else if (!/^https:\/\/[^/?#@\\\s]+\/?$/.test(configured)) return null
  try {
    const url = new URL(configured)
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}
