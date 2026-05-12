"use client"

import { Button, useToast } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect, useState } from "react"

import { GoogleIcon, Spinner } from "@/components/icons"
import { AUTH_EVENTS } from "@/lib/posthog/events"
import { createBrowserClient } from "@/lib/supabase/client"

function Logo() {
  return (
    <div className="mb-8">
      <Link href="/" className="flex items-center gap-2">
        <Image
          src="/logo.svg"
          alt="Superserve"
          width={200}
          height={40}
          className="mb-2 h-10 w-auto"
        />
      </Link>
    </div>
  )
}

function DevicePageContent() {
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isAuthorizing, setIsAuthorizing] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const { addToast } = useToast()

  const searchParams = useSearchParams()
  const posthog = usePostHog()
  const userCode = searchParams.get("code")

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

        if (session?.user) {
          const {
            data: { user: authUser },
            error: userError,
          } = await supabase.auth.getUser()
          if (userError?.code === "user_not_found") {
            await supabase.auth.signOut()
            return
          }
          if (authUser) {
            setUser({ id: authUser.id, email: authUser.email })
            if (posthog) {
              posthog.identify(authUser.id, { email: authUser.email })
            }
          }
        }
      } catch (_error) {
        await supabase.auth.signOut()
      } finally {
        setIsCheckingSession(false)
      }
    }
    checkUser()
  }, [posthog])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      const supabase = createBrowserClient()
      const callbackUrl = new URL("/auth/callback", window.location.origin)
      callbackUrl.searchParams.set(
        "next",
        `/device?code=${encodeURIComponent(userCode ?? "")}`,
      )

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
        },
      })

      if (error) {
        console.error("Error signing in:", error)
        addToast("Error signing in. Please try again.", "error")
      }
    } catch (err) {
      console.error("Sign in error:", err)
      addToast("Error signing in. Please try again.", "error")
    } finally {
      setIsLoading(false)
    }
  }

  const handleAuthorize = async () => {
    if (!userCode || !user) return

    setIsAuthorizing(true)

    try {
      const supabase = createBrowserClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error("Session expired. Please sign in again.")
      }

      const response = await fetch(`/api/v1/auth/device-authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_code: userCode,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || "Failed to authorize device")
      }

      setIsAuthorized(true)
      if (posthog) {
        posthog.capture(AUTH_EVENTS.DEVICE_AUTHORIZED, {
          user_email: user.email,
        })
      }
    } catch (err) {
      console.error("Authorization error:", err)
      const message =
        err instanceof Error ? err.message : "Failed to authorize device"
      addToast(message, "error")
    } finally {
      setIsAuthorizing(false)
    }
  }

  // No code provided
  if (!userCode) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="border border-dashed border-border bg-surface p-8 text-center">
              <h1 className="mb-4 text-xl font-semibold text-foreground">
                Invalid Request
              </h1>
              <p className="text-sm text-muted">
                No device code provided. Run{" "}
                <code className="bg-background px-2 py-1 text-xs">
                  superserve login
                </code>{" "}
                from your terminal.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Successfully authorized
  if (isAuthorized) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="border border-dashed border-border bg-surface p-8 text-center">
              <svg
                className="mx-auto mb-4 h-12 w-12 text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <h1 className="mb-2 text-xl font-semibold text-foreground">
                Device Authorized
              </h1>
              <p className="text-sm text-muted">
                You can close this tab and return to your terminal.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Checking session
  if (isCheckingSession) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="border border-dashed border-border bg-surface p-8 text-center">
              <Spinner className="mx-auto border-muted" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Not signed in - show sign-in options
  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="border border-dashed border-border bg-surface p-8">
              <h1 className="mb-2 text-center text-xl font-semibold text-foreground">
                Authorize Device
              </h1>
              <p className="mb-6 text-center text-sm text-muted">
                Sign in to authorize your CLI.
              </p>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full gap-3"
              >
                {isLoading ? (
                  <Spinner className="border-dashed border-primary" />
                ) : (
                  <GoogleIcon />
                )}
                {isLoading ? "Signing in..." : "Continue with Google"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Signed in - show authorize button
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
        <Logo />
        <div className="w-full max-w-sm">
          <div className="border border-dashed border-border bg-surface p-8 text-center">
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              Authorize Device
            </h1>
            <p className="mb-8 text-sm text-muted">
              Signed in as{" "}
              <span className="font-medium text-foreground">{user.email}</span>
            </p>
            <p className="mb-2 text-xs text-muted">
              Confirm to authorize your CLI with code:
            </p>
            <code className="mb-3 flex justify-center bg-background px-3 py-2 font-mono text-2xl font-medium tracking-wide text-primary">
              {userCode}
            </code>
            <Button
              type="button"
              onClick={handleAuthorize}
              disabled={isAuthorizing}
              className="w-full"
            >
              {isAuthorizing ? <Spinner /> : null}
              {isAuthorizing ? "Authorizing..." : "Authorize Device"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DevicePage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen overflow-hidden bg-background">
          <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
            <Logo />
            <div className="w-full max-w-sm">
              <div className="border border-dashed border-border bg-surface p-8 text-center">
                <Spinner className="mx-auto border-muted" />
              </div>
            </div>
          </div>
        </div>
      }
    >
      <DevicePageContent />
    </Suspense>
  )
}
