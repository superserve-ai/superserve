import crypto from "node:crypto"

const PURPOSE = "signup_device_binding_v1"

function secret(): string | undefined {
  const value = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  return value && value.length >= 32 ? value : undefined
}

export function signSignupDeviceBinding(
  userId: string,
  attemptId: string,
): string | undefined {
  const key = secret()
  if (!key) return undefined
  return crypto
    .createHmac("sha256", key)
    .update(`${PURPOSE}:${userId}:${attemptId}`)
    .digest("base64url")
}

export function validSignupDeviceBinding(
  userId: string,
  attemptId: string,
  supplied: string,
): boolean {
  try {
    const expected = signSignupDeviceBinding(userId, attemptId)
    if (
      !expected ||
      !supplied ||
      supplied !== Buffer.from(supplied, "base64url").toString("base64url")
    )
      return false
    const actualBytes = Buffer.from(supplied, "base64url")
    const expectedBytes = Buffer.from(expected, "base64url")
    return (
      actualBytes.length === expectedBytes.length &&
      crypto.timingSafeEqual(actualBytes, expectedBytes)
    )
  } catch {
    return false
  }
}
