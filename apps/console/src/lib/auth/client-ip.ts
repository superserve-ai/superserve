import "server-only"
import { headers } from "next/headers"

// Vercel overwrites x-real-ip and x-forwarded-for with the connecting client's
// IP. Other client IP headers, such as cf-connecting-ip, pass through as sent,
// so a caller could rotate them to get a fresh bucket.
export async function readClientIp(): Promise<string | undefined> {
  try {
    const requestHeaders = await headers()
    return (
      requestHeaders.get("x-real-ip")?.trim() ||
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      undefined
    )
  } catch {
    return undefined
  }
}
