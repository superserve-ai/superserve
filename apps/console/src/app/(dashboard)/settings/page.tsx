"use client"

import { createBrowserClient } from "@superserve/supabase"
import { Spinner } from "@/components/icons"
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Separator,
  useToast,
} from "@superserve/ui"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { useUser } from "@/hooks/use-user"

export default function SettingsPage() {
  const { user, loading } = useUser()
  const { addToast } = useToast()

  const [name, setName] = useState("")
  const [nameLoaded, setNameLoaded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

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
      addToast("Password updated", "success")
    } catch {
      addToast("Failed to update password", "error")
    } finally {
      setSavingPassword(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      // TODO: call server action to delete account via admin API
      addToast(
        "Account deletion requested. Contact support@superserve.ai",
        "success",
      )
      setDeleteOpen(false)
      setDeleteConfirmText("")
    } finally {
      setDeleting(false)
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
            <FormField label="Full Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </FormField>
            <FormField label="Email">
              <Input value={email} disabled />
            </FormField>
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
                <FormField label="Current Password">
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label="New Password">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </FormField>
                <FormField label="Confirm New Password">
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </FormField>
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
          <div className="max-w-md space-y-5">
            <p className="text-xs text-muted">
              Permanently delete your account and all associated data including
              sandboxes, snapshots, and API keys. This action cannot be undone.
            </p>
            <div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                Delete Account
              </Button>
              <Dialog
                open={deleteOpen}
                onOpenChange={(v) => {
                  setDeleteOpen(v)
                  if (!v) setDeleteConfirmText("")
                }}
              >
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Delete Account</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 p-6 pt-2">
                    <p className="text-sm text-muted">
                      This will permanently delete your account and all
                      associated data including sandboxes, snapshots, and API
                      keys. This action cannot be undone.
                    </p>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="delete-confirm"
                        className="block text-sm font-medium text-foreground"
                      >
                        Type{" "}
                        <span className="font-mono mx-1">delete account</span>{" "}
                        to confirm
                      </label>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="delete account"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDeleteOpen(false)
                        setDeleteConfirmText("")
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={
                        deleteConfirmText !== "delete account" || deleting
                      }
                      onClick={handleDeleteAccount}
                    >
                      {deleting ? "Deleting..." : "Delete Account"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
