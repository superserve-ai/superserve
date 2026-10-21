import "server-only"
import { createHash, createPrivateKey, sign } from "node:crypto"

import { cellFor } from "@/lib/cells"

export class AcceptanceError extends Error {
  constructor(
    public readonly kind: "signin" | "unavailable" | "forbidden" | "conflict",
  ) {
    super(kind)
    this.name = "AcceptanceError"
  }
}

// Callers resolve the actor and home region from a fresh authenticated account
// and membership. No browser headers, actor fields or endpoint URLs are forwarded.
export async function postYCAccount(
  actor: string,
  region: string,
  channel: "offers" | "renewals",
  operation: "offer" | "accept" | "status" | "review" | "submit",
  value: Record<string, unknown>,
): Promise<unknown> {
  if (
    !(
      channel === "offers"
        ? ["offer", "accept", "status", "review"]
        : ["status", "submit"]
    ).includes(operation)
  )
    throw new AcceptanceError("unavailable")
  const path = `/internal/yc/account/${channel}/${operation}`
  const body = JSON.stringify(value)
  const origin = new URL(cellFor(region).apiBaseUrl)
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new AcceptanceError("unavailable")
  const key = createPrivateKey(process.env.PROMOTION_ACCOUNT_PRIVATE_KEY ?? "")
  if (key.asymmetricKeyType !== "ed25519")
    throw new AcceptanceError("unavailable")
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT" }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: "promotion-auth-adapter",
      aud: channel === "offers" ? "yc-acceptance" : "yc-renewal",
      sub: actor,
      iat: now,
      exp: now + 60,
      operation,
      method: "POST",
      path,
      body_sha256: createHash("sha256").update(body).digest("hex"),
    }),
  ).toString("base64url")
  const input = `${header}.${payload}`
  let response
  try {
    response = await fetch(new URL(path, origin), {
      method: "POST",
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        [channel === "offers"
          ? "X-YC-Acceptance-Assertion"
          : "X-YC-Renewal-Assertion"]:
          `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`,
      },
    })
  } catch {
    throw new AcceptanceError("unavailable")
  }
  if (!response.ok)
    throw new AcceptanceError(
      response.status === 403
        ? "forbidden"
        : response.status === 409
          ? "conflict"
          : "unavailable",
    )
  return response.json()
}
