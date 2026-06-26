/**
 * Shared self-healing retry for data-plane operations.
 *
 * A paused sandbox answers the data plane two ways: `401` (the per-sandbox
 * access token is no longer valid) or `503` (the VM isn't running). Both clear
 * by `POST /activate`, which resumes the sandbox and rotates the access token.
 * So on either signal we activate once and retry the operation with the fresh
 * token — this is what makes "a command/file op auto-resumes a paused sandbox"
 * true. Any other failure (404, 409, a genuine 500, …) propagates untouched.
 *
 * `commands` and `files` both run through this single predicate so the resume
 * policy can't drift between them.
 */

import { AuthenticationError, ServerError } from "./errors.js"

/** @internal Live token accessor + the slow-path resume both share. */
export interface TokenRetryDeps {
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
}

/**
 * Does this error mean the sandbox is paused/unreachable and a `POST /activate`
 * would fix it? 401/403 (stale token) or 503 (VM not running). A genuine 500
 * is NOT resumable — only 503 signals a paused sandbox.
 * @internal
 */
export function isResumable(err: unknown): boolean {
  if (err instanceof AuthenticationError) return true
  if (err instanceof ServerError) return err.statusCode === 503
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
  try {
    return await send(deps.getAccessToken())
  } catch (err) {
    if (!isResumable(err)) throw err
    const fresh = await deps.refreshActivate()
    return send(fresh)
  }
}
