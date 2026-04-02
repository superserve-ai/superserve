import { createServerClient } from "@superserve/supabase/server"
import { NextResponse } from "next/server"
import { notifySlackOfNewUser } from "@/app/(auth)/auth/signin/action"
import { sendWelcomeEmail } from "@/app/(auth)/auth/signup/action"

const TRUSTED_REDIRECT_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?superserve\.ai(\/.*)?$/

function buildRedirectUrl(origin: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || origin
  return `${base}${path}`
}

function sanitizeNext(raw: string | null): string {
  const next = raw ?? "/"
  if (next.startsWith("/") && !next.startsWith("//")) return next
  if (TRUSTED_REDIRECT_PATTERN.test(next)) return next
  return "/"
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as
    | "signup"
    | "recovery"
    | "invite"
    | "magiclink"
    | "email"
    | null
  let next = sanitizeNext(searchParams.get("next"))

  if (code || tokenHash) {
    const supabase = await createServerClient()

    let error = null
    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code)
      error = result.error
    } else if (tokenHash && type) {
      const result = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
      error = result.error
    }

    if (error) {
      console.error("Auth callback error:", error.message, {
        code: !!code,
        tokenHash: !!tokenHash,
        type,
      })
    }

    if (!error) {
      if (next === "/auth/reset-password" || type === "recovery") {
        return NextResponse.redirect(
          buildRedirectUrl(origin, "/auth/reset-password"),
        )
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const createdAt = new Date(user.created_at)
        const now = new Date()
        const isNewUser = now.getTime() - createdAt.getTime() < 30000

        const provider = code
          ? user.app_metadata?.provider || "google"
          : "email"

        if (isNewUser) {
          await notifySlackOfNewUser(
            user.email || "",
            user.user_metadata?.full_name || null,
            user.app_metadata?.provider || null,
          )
          sendWelcomeEmail(
            user.email || "",
            user.user_metadata?.full_name || "there",
          ).catch(() => {})
        }

        if (next.startsWith("/device") || next.startsWith("https://")) {
          // keep redirect as-is
        } else {
          const params = new URLSearchParams()
          if (isNewUser) {
            params.set("new_user", "1")
            params.set("provider", provider)
          }
          next = params.toString()
            ? `/get-started?${params.toString()}`
            : "/get-started"
        }
      }

      if (next.startsWith("https://")) {
        return NextResponse.redirect(next)
      }
      return NextResponse.redirect(buildRedirectUrl(origin, next))
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
