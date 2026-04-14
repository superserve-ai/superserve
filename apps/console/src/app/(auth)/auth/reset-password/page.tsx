"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
import { DitherBackground } from "@/components/dither-background"
import { Spinner } from "@/components/icons"

function ResetPasswordContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    const newErrors: Record<string, string> = {}
    if (!password) newErrors.password = "Password is required."
    else if (password.length < 8)
      newErrors.password = "Must be at least 8 characters."
    if (password && password !== confirmPassword)
      newErrors.confirmPassword = "Passwords do not match."
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setIsLoading(true)
    try {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setErrors({ form: "Failed to update password. Please try again." })
        return
      }
      setSuccess(true)
      redirectTimerRef.current = setTimeout(
        () => router.push("/auth/signin"),
        2000,
      )
    } catch {
      setErrors({ form: "Error resetting password. Please try again." })
    } finally {
      setIsLoading(false)
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

        {success ? (
          <>
            <h1 className="text-center text-sm font-medium text-foreground">
              Password Updated
            </h1>
            <p className="mt-2 text-center text-xs text-muted">
              Redirecting to sign in...
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-6 text-center text-sm font-medium text-foreground">
              Set a new password
            </h1>

            <form onSubmit={handleResetPassword} className="space-y-3">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="New Password"
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
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={errors.confirmPassword}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-muted"
                  >
                    {showConfirmPassword ? (
                      <EyeSlashIcon className="size-4" weight="light" />
                    ) : (
                      <EyeIcon className="size-4" weight="light" />
                    )}
                  </button>
                }
              />
              {errors.form && (
                <p className="text-xs text-destructive">{errors.form}</p>
              )}
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? <Spinner /> : null}
                {isLoading ? "Updating..." : "Update Password"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted">
              <Link
                href="/auth/signin"
                className="font-medium text-foreground hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
