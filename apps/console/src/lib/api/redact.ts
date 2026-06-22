/**
 * Strip the per-sandbox `access_token` from control-plane JSON responses.
 *
 * `access_token` is the DATA-PLANE credential: the terminal WebSocket and the
 * file upload/download panels use it to talk DIRECTLY to `boxd-…` endpoints,
 * which never pass through the console proxy. While an admin is impersonating a
 * team (read-only), the proxy redacts it so the browser never receives a usable
 * data-plane token — otherwise the read-only gate (GET-only proxy + server
 * action guards) could be bypassed by exec-ing or writing files as the customer.
 */

/** Recursively rebuild `value` without any `access_token` keys (immutable). */
export function stripAccessTokens(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripAccessTokens)
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (key === "access_token") continue
      out[key] = stripAccessTokens(child)
    }
    return out
  }
  return value
}

/**
 * Return `jsonText` with every `access_token` removed. Parses-and-rebuilds for
 * correctness; if the body claims JSON but does not parse (should never happen
 * for our control plane), falls back to a textual strip so a malformed payload
 * still cannot leak the credential — fail closed, never open.
 */
export function redactAccessTokens(jsonText: string): string {
  try {
    return JSON.stringify(stripAccessTokens(JSON.parse(jsonText)))
  } catch {
    return jsonText.replace(
      /"access_token"\s*:\s*"[^"]*"/g,
      '"access_token":""',
    )
  }
}
