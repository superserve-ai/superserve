"use client"

import { ToastProvider } from "@superserve/ui"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { InviteMembersDialog } from "@/app/(dashboard)/team/invite-members-dialog"
import { TeamClient } from "@/app/(dashboard)/team/team-client"

import { fixtureRoles, fixtureTeam } from "../hooks"

function Fixture() {
  const scenario = useSearchParams().get("scenario") ?? "page"
  const [open, setOpen] = useState(scenario !== "page")
  useEffect(() => {
    if (scenario === "page" || !open) return
    const timer = setTimeout(() => {
      const input = document.getElementById("invite-emails")
      if (!input) return
      const clipboard = new DataTransfer()
      clipboard.setData(
        "text",
        scenario === "results"
          ? "sent@example.com member@example.com invited@example.com delivery@example.com"
          : "avery@example.com blake@example.com invalid drew@example.com",
      )
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          clipboardData: clipboard,
        }),
      )
      requestAnimationFrame(() => {
        const selects = document.querySelectorAll<HTMLSelectElement>(
          "select[aria-label^='Role for']",
        )
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set
        if (scenario === "results") {
          selects.forEach((select, index) => {
            setter?.call(
              select,
              ["team_admin", "viewer", "billing_admin", "user_admin"][index],
            )
            select.dispatchEvent(new Event("change", { bubbles: true }))
          })
          const button = Array.from(document.querySelectorAll("button")).find(
            (item) => item.textContent?.includes("Send invites"),
          )
          button?.click()
        }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [scenario, open])
  return (
    <ToastProvider>
      <main className="h-screen bg-background text-foreground">
        <TeamClient />
        {open && (
          <InviteMembersDialog
            team={fixtureTeam}
            invitableRoles={scenario === "legacy" ? undefined : fixtureRoles}
            onOpenChange={setOpen}
          />
        )}
      </main>
    </ToastProvider>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Fixture />
    </Suspense>
  )
}
