import crypto from "node:crypto"

/** @internal — exported for tests. */
export function getProxySecret(): string {
  const secret = process.env.CONSOLE_PROXY_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      "CONSOLE_PROXY_SECRET env var is required and must be at least 32 characters",
    )
  }
  return secret
}

/** @internal — exported for tests. */
export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}
