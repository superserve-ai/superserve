import "server-only"
import crypto from "node:crypto"

export interface CheckoutIntent {
  actor: string
  team: string
  operation_id: string
  home_region: string
  decision: "standard" | "publication_failed"
  success_url: string
  cancel_url: string
}
function mac(payload: string): Buffer {
  const secret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!secret || secret.length < 32)
    throw new Error("Checkout intent signing unavailable")
  return crypto
    .createHmac("sha256", secret)
    .update(`checkout-intent-v1:${payload}`)
    .digest()
}
export function validOperationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    ) &&
    value !== "00000000-0000-0000-0000-000000000000"
  )
}
export function signCheckoutIntent(intent: CheckoutIntent): string {
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url")
  return `${payload}.${mac(payload).toString("base64url")}`
}
export function readCheckoutIntent(
  receipt: unknown,
  actor: string,
  team: string,
  region: string,
): CheckoutIntent {
  if (typeof receipt !== "string" || receipt.length > 16000)
    throw new Error("Invalid Checkout intent")
  const [payload, supplied, extra] = receipt.split(".")
  if (!payload || !supplied || extra) throw new Error("Invalid Checkout intent")
  const bytes = Buffer.from(supplied, "base64url")
  const expected = mac(payload)
  if (
    bytes.toString("base64url") !== supplied ||
    bytes.length !== expected.length ||
    !crypto.timingSafeEqual(bytes, expected)
  )
    throw new Error("Invalid Checkout intent")
  const intent: CheckoutIntent = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  )
  if (
    intent.actor !== actor ||
    intent.team !== team ||
    intent.home_region !== region ||
    !validOperationId(intent.operation_id) ||
    !["standard", "publication_failed"].includes(intent.decision)
  )
    throw new Error("Invalid Checkout intent")
  return intent
}
/** Renew authentication, never the retained publication decision. */
export function checkoutAssertion(intent: CheckoutIntent): string {
  const privateKey = crypto.createPrivateKey(
    process.env.PROMOTION_ACCOUNT_PRIVATE_KEY ?? "",
  )
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Checkout signer unavailable")
  const now = Math.floor(Date.now() / 1000)
  const { actor, team, ...fields } = intent
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT" }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: "promotion-auth-adapter",
      aud: "promotion-account",
      sub: actor,
      iat: now,
      exp: now + 300,
      operation: "checkout",
      team_id: team,
      ...fields,
    }),
  ).toString("base64url")
  const input = `${header}.${payload}`
  return `${input}.${crypto.sign(null, Buffer.from(input), privateKey).toString("base64url")}`
}
