"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { createBrowserClient } from "@superserve/supabase"
import { Button, Input } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Suspense, useState } from "react"
import { CornerBrackets } from "@/components/corner-brackets"
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
      setTimeout(() => router.push("/auth/signin"), 2000)
    } catch {
      setErrors({ form: "Error resetting password. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-6">
        <Link href="/">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={200}
            height={40}
            className="h-8 w-auto"
          />
        </Link>
      </div>

      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

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
            <h1 className="text-center text-sm font-medium text-foreground">
              Reset Password
            </h1>
            <p className="mb-6 text-center text-xs text-muted">
              Enter your new password
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
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
                {errors.password && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.password}
                  </p>
                )}
              </div>
              <div>
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={errors.confirmPassword}
                  suffix={
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
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
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.confirmPassword}
                  </p>
                )}
              </div>
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
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
