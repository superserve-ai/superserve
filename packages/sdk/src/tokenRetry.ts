import { AuthenticationError, ServerError, SandboxError } from "./errors.js"
/**
 * Shared retry policy for command and file operations. Authentication failures
 * and proven pre-dispatch routing failures activate once before retrying.
 * Hinted requests require a specific error code for 503 responses; unhinted
 * requests retain the legacy 503 auto-resume behavior.
 */
import { routingHintExpired } from "./routingHint.js"

/** @internal Live token accessor + the slow-path resume both share. */
export interface TokenRetryDeps {
  getAccessToken: () => string
  getRoutingHint?: () => string | undefined
  refreshActivate: () => Promise<string>
}

/** @internal Whether activation can resolve a pre-dispatch failure. */
export function isResumable(err: unknown, hinted = false): boolean {
  if (
    err instanceof SandboxError &&
    err.statusCode === 404 &&
    err.code === "sandbox_route_stale"
  )
    return true
  if (err instanceof AuthenticationError) return true
  if (err instanceof ServerError)
    return (
      err.statusCode === 503 && (!hinted || err.code === "sandbox_unavailable")
    )
  return false
}

/**
 * Run `send` with the current access token. On a resumable failure, activate
 * (resume + rotate token) and retry exactly once with the fresh token.
 * @internal
 */
export async function withTokenRetry<T>(
  deps: TokenRetryDeps,
  send: (token: string) => Promise<T>,
): Promise<T> {
  if (routingHintExpired(deps)) await deps.refreshActivate()
  const hinted = Boolean(deps.getRoutingHint?.())
  try {
    return await send(deps.getAccessToken())
  } catch (err) {
    if (!isResumable(err, hinted)) throw err
    const fresh = await deps.refreshActivate()
    return send(fresh)
  }
}
