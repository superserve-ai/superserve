import crypto from "node:crypto"

// Run with the effective production environment before promotion of the build.
if (
  process.env.VERCEL_ENV === "production" ||
  process.env.REQUIRE_PROMOTION_CONFIG === "1"
) {
  const cutoff = process.env.PROMOTION_SIGNUP_EVIDENCE_SINCE ?? ""
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(cutoff) ||
    !Number.isFinite(Date.parse(cutoff))
  )
    throw new Error(
      "Set the fixed PROMOTION_SIGNUP_EVIDENCE_SINCE rollout timestamp before deploying",
    )
  const tokens = [
    process.env.PROMOTION_CAPTURE_TOKEN,
    process.env.PROMOTION_ACCOUNT_TOKEN,
  ]
  if (process.env.SUPABASE_USWEST_URL)
    tokens.push(process.env.PROMOTION_ACCOUNT_TOKEN_USWEST)
  if (tokens.some((value) => !value) || new Set(tokens).size !== tokens.length)
    throw new Error("Promotion producer tokens must be configured and distinct")
  if (
    tokens.some(
      (value) =>
        value === process.env.INTERNAL_API_TOKEN ||
        value === process.env.SANDBOX_INTERNAL_API_TOKEN,
    )
  )
    throw new Error(
      "Promotion producer tokens must not reuse the general internal token",
    )
  if ((process.env.GOOGLE_SIGNUP_PROOF_SECRET?.length ?? 0) < 32)
    throw new Error(
      "Configure the persistent signup and Checkout receipt signing secret",
    )
  if (
    crypto.createPrivateKey(process.env.PROMOTION_ACCOUNT_PRIVATE_KEY ?? "")
      .asymmetricKeyType !== "ed25519"
  )
    throw new Error("Promotion account signer must use Ed25519")
  console.log("Promotion production configuration validated")
}
