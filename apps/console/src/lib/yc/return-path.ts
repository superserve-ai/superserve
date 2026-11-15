// A return path is navigation only. The destination always rechecks the
// authenticated account and durable claim before displaying an offer.
export function ycReturnPath(raw: string | null | undefined): string | null {
  if (
    !raw ||
    raw.includes("\\") ||
    !raw.startsWith("/") ||
    raw.startsWith("//")
  )
    return null
  // The URL parser drops tabs and newlines, so "/\n/[" passes the checks
  // above and then fails to parse as a host.
  let url: URL
  try {
    url = new URL(raw, "https://console.invalid")
  } catch {
    return null
  }
  if (
    url.origin !== "https://console.invalid" ||
    url.hash ||
    !/^\/yc\/(claim|accept|renewal)\/?$/.test(url.pathname)
  )
    return null
  for (const key of url.searchParams.keys()) if (key !== "claim") return null
  if (url.searchParams.getAll("claim").length > 1) return null
  const claim = url.searchParams.get("claim")
  if (
    claim !== null &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      claim,
    )
  )
    return null
  return `${url.pathname.replace(/\/$/, "")}${claim ? `?claim=${claim}` : ""}`
}
