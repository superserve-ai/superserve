"use client"

import { createBrowserClient } from "@superserve/supabase"
import { Button, Field, Input, Separator, useToast } from "@superserve/ui"
import { usePostHog } from "posthog-js/react"
import { useEffect, useState } from "react"
import { Spinner } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { useUser } from "@/hooks/use-user"
import { SETTINGS_EVENTS } from "@/lib/posthog/events"

export default function SettingsPage() {
  const { user, loading } = useUser()
  const posthog = usePostHog()
  const { addToast } = useToast()

  const [name, setName] = useState("")
  const [nameLoaded, setNameLoaded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (user && !nameLoaded) {
      setName(user.user_metadata?.full_name || user.user_metadata?.name || "")
      setNameLoaded(true)
    }
  }, [user, nameLoaded])

  const email = user?.email || ""
  const isOAuth = user?.app_metadata?.provider === "google"

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name },
      })
      if (error) throw error
      posthog.capture(SETTINGS_EVENTS.PROFILE_UPDATED)
      addToast("Profile updated", "success")
    } catch {
      addToast("Failed to update profile", "error")
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword) {
      addToast("Current password is required", "error")
      return
    }
    if (newPassword !== confirmPassword) {
      addToast("Passwords do not match", "error")
      return
    }
    if (newPassword.length < 8) {
      addToast("Password must be at least 8 characters", "error")
      return
    }
    setSavingPassword(true)
    try {
      const supabase = createBrowserClient()
      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (signInError) {
        addToast("Current password is incorrect", "error")
        return
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })
      if (error) throw error
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      posthog.capture(SETTINGS_EVENTS.PASSWORD_CHANGED)
      addToast("Password updated", "success")
    } catch {
      addToast("Failed to update password", "error")
    } finally {
      setSavingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Settings" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="border-foreground/20 border-t-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto">
        {/* Profile */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <h2 className="text-base font-medium text-foreground">Profile</h2>
            <p className="mt-1 text-xs text-muted">
              Your personal account details.
            </p>
          </div>
          <div className="max-w-md space-y-5">
            <Field label="Full Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </Field>
            <Field label="Email">
              <Input value={email} disabled />
            </Field>
            <div>
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                size="sm"
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Password */}
        {!isOAuth && (
          <>
            <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
              <div>
                <h2 className="text-base font-medium text-foreground">
                  Password
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Update your account password.
                </p>
              </div>
              <div className="max-w-md space-y-5">
                <Field label="Current Password">
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="New Password">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="Confirm New Password">
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <div>
                  <Button
                    onClick={handleChangePassword}
                    disabled={
                      savingPassword ||
                      !currentPassword ||
                      !newPassword ||
                      !confirmPassword
                    }
                    size="sm"
                  >
                    {savingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </div>
            </div>

            <Separator />
          </>
        )}

        {/* Danger Zone */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <h2 className="text-base font-medium text-destructive">
              Danger Zone
            </h2>
            <p className="mt-1 text-xs text-muted">Irreversible actions.</p>
          </div>
          <div className="max-w-md">
            <p className="text-xs text-muted leading-loose">
              To delete your account and all associated data, please contact us
              at{" "}
              <a
                href="mailto:support@superserve.ai"
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                support@superserve.ai
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
