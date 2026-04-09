"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect, useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { GoogleIcon, Spinner } from "@/components/icons"
import { DEV_AUTH_ENABLED, devSignIn } from "@/lib/auth-helpers"
import { AUTH_EVENTS } from "@/lib/posthog/events"

function SignInContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [isEmailLoading, setIsEmailLoading] = useState(false)
  const [isDevLoading, setIsDevLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const router = useRouter()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  const rawNext = searchParams.get("next") || "/"
  const nextUrl =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/"

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createBrowserClient()
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()
        if (error) {
          await supabase.auth.signOut()
          return
        }
        if (session) {
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser()
          if (userError || !user) {
            await supabase.auth.signOut()
            return
          }
          router.push(nextUrl)
        }
      } catch {
        await supabase.auth.signOut()
      }
    }
    checkUser()
  }, [router, nextUrl])

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    if (!email) {
      setErrors((prev) => ({ ...prev, email: "Email is required." }))
      return
    }
    if (!password) {
      setErrors((prev) => ({ ...prev, password: "Password is required." }))
      return
    }
    setIsEmailLoading(true)
    try {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        posthog.capture(AUTH_EVENTS.SIGN_IN_FAILED, {
          method: "email",
          reason: error.message,
        })
        if (error.message.includes("Invalid login credentials")) {
          setErrors({ form: "Invalid email or password." })
        } else if (error.message.includes("Email not confirmed")) {
          setErrors({ form: "Please verify your email before signing in." })
        } else {
          setErrors({ form: "Error signing in. Please try again." })
        }
        return
      }
      posthog.capture(AUTH_EVENTS.SIGN_IN_COMPLETED, { method: "email" })
      router.push(nextUrl)
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      setIsEmailLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    setErrors({})
    try {
      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      if (nextUrl && nextUrl !== "/") {
        callbackUrl.searchParams.set("next", nextUrl)
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      })
      if (error) {
        setErrors({ form: "Error signing in. Please try again." })
      }
    } catch {
      setErrors({ form: "Error signing in. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDevSignIn = async () => {
    if (!DEV_AUTH_ENABLED) return
    setIsDevLoading(true)
    setErrors({})
    try {
      const result = await devSignIn()
      if (!result.success) {
        setErrors({ form: result.error || "Dev auth failed." })
        return
      }
      router.push(nextUrl)
    } catch {
      setErrors({ form: "Dev auth failed." })
    } finally {
      setIsDevLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <DitherBackground />
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Superserve"
              width={120}
              height={24}
              className="h-6 w-auto"
            />
          </Link>
        </div>

        <h1 className="mb-6 text-center text-sm font-medium text-foreground">
          Sign in to Superserve
        </h1>

        {/* Google OAuth — first */}
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full gap-2 border-solid font-sans normal-case tracking-normal"
        >
          {isLoading ? <Spinner /> : <GoogleIcon />}
          {isLoading ? "Signing in..." : "Continue with Google"}
        </Button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-dashed border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-muted">or</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <div>
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email}</p>
            )}
          </div>
          <div>
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="size-4" weight="light" />
                  ) : (
                    <EyeIcon className="size-4" weight="light" />
                  )}
                </button>
              }
            />
            {errors.password && (
              <p className="mt-1 text-xs text-destructive">{errors.password}</p>
            )}
          </div>
          <div className="flex justify-end">
            <Link
              href="/auth/forgot-password"
              className="text-xs text-muted/60 hover:text-muted"
            >
              Forgot password?
            </Link>
          </div>
          {errors.form && (
            <p className="text-xs text-destructive">{errors.form}</p>
          )}
          <Button type="submit" disabled={isEmailLoading} className="w-full">
            {isEmailLoading ? <Spinner /> : null}
            {isEmailLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        {/* Sign up link */}
        <p className="mt-5 text-center text-xs text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/signup"
            className="font-medium text-foreground hover:underline"
          >
            Sign up
          </Link>
        </p>

        {/* Privacy */}
        <p className="mt-6 text-center text-xs leading-relaxed text-muted/60">
          By continuing, you agree to our{" "}
          <a
            href={`${process.env.NEXT_PUBLIC_WEBSITE_URL}/privacy`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            Privacy Policy
          </a>
        </p>

        {/* Dev Auth */}
        {DEV_AUTH_ENABLED && (
          <div className="mt-4 border-t border-dashed border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDevSignIn}
              disabled={isDevLoading}
              className="w-full text-muted"
            >
              {isDevLoading ? <Spinner /> : null}
              {isDevLoading ? "Signing in..." : "Dev Sign In"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  )
}
