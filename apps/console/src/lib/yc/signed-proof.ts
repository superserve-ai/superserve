import "server-only"
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto"

function key() {
  const value = createPrivateKey(
    process.env.PROMOTION_ACCOUNT_PRIVATE_KEY ?? "",
  )
  if (value.asymmetricKeyType !== "ed25519")
    throw new Error("Signing unavailable")
  return value
}
export function signProof(
  purpose: string,
  fields: Record<string, unknown>,
  seconds: number,
): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(
    JSON.stringify({ ...fields, purpose, iat: now, exp: now + seconds }),
  ).toString("base64url")
  return `${payload}.${sign(null, Buffer.from(payload), key()).toString("base64url")}`
}
export function readProof(
  raw: string | undefined,
  purpose: string,
  maximumAge: number,
): Record<string, unknown> {
  if (!raw || raw.length > 4096) throw new Error("Reauthentication required")
  const [payload, signature, extra] = raw.split(".")
  if (
    !payload ||
    !signature ||
    extra ||
    !verify(
      null,
      Buffer.from(payload),
      createPublicKey(key()),
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("Reauthentication required")
  const proof = JSON.parse(Buffer.from(payload, "base64url").toString())
  const now = Math.floor(Date.now() / 1000)
  if (
    proof.purpose !== purpose ||
    !Number.isSafeInteger(proof.iat) ||
    !Number.isSafeInteger(proof.exp) ||
    proof.iat > now ||
    proof.exp <= now ||
    proof.exp <= proof.iat ||
    proof.exp - proof.iat > maximumAge
  )
    throw new Error("Reauthentication required")
  return proof
}
