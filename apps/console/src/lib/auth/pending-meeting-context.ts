export const PENDING_MEETING_COOKIE = "ss-enterprise-meeting"
const TTL_SECONDS = 24 * 60 * 60
const PURPOSE = "enterprise-meeting"

export const pendingMeetingCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/auth/pending",
  maxAge: TTL_SECONDS,
}

async function key() {
  const secret = process.env.GOOGLE_SIGNUP_PROOF_SECRET
  if (!secret || secret.length < 32) return null
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

export async function createPendingMeetingContext(userId: string) {
  const signingKey = await key()
  if (!signingKey) return null
  const payload = Buffer.from(
    JSON.stringify({
      purpose: PURPOSE,
      sub: userId,
      exp: Date.now() + TTL_SECONDS * 1000,
    }),
  ).toString("base64url")
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    new TextEncoder().encode(payload),
  )
  return `${payload}.${Buffer.from(signature).toString("base64url")}`
}

export async function verifyPendingMeetingContext(value: string | undefined) {
  if (!value || value.length > 1024) return null
  try {
    const signingKey = await key()
    if (!signingKey) return null
    const parts = value.split(".")
    if (
      parts.length !== 2 ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      return null
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        signingKey,
        Buffer.from(parts[1], "base64url"),
        new TextEncoder().encode(parts[0]),
      ))
    )
      return null
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
    if (
      data.purpose !== PURPOSE ||
      typeof data.sub !== "string" ||
      !data.sub ||
      data.sub.length > 128 ||
      typeof data.exp !== "number" ||
      data.exp <= Date.now() ||
      data.exp > Date.now() + TTL_SECONDS * 1000
    )
      return null
    return data.sub as string
  } catch {
    return null
  }
}
