"use client"

import { ToastProvider } from "@superserve/ui"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { InviteMembersDialog } from "@/app/(dashboard)/team/invite-members-dialog"
import { TeamClient } from "@/app/(dashboard)/team/team-client"

import { fixtureRoles, fixtureTeam } from "../hooks"

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

async function waitFor<T>(find: () => T | null | undefined | false) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = find()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Fixture wait timed out: ${find}`)
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 100))
}

function key(name: string) {
  const target = document.activeElement ?? document.body
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(
      new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }),
    )
  }
}

function visibleOptions() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[role='option']"),
  ).filter((item) => item.checkVisibility())
}

// The shared Select is not a native <select>, so choose a role the way a
// keyboard user does: open it, move to the option, press Enter.
async function chooseRole(trigger: HTMLElement, label: string) {
  trigger.focus()
  key("ArrowDown")
  const options = await waitFor(() => {
    const items = visibleOptions()
    return items.length > 0 && items
  })
  const from = Math.max(
    0,
    options.findIndex((item) => item.getAttribute("aria-selected") === "true"),
  )
  const to = options.findIndex((item) => item.textContent?.trim() === label)
  for (let step = from; step !== to; step += to > from ? 1 : -1) {
    await pause()
    key(to > from ? "ArrowDown" : "ArrowUp")
  }
  await pause()
  key("Enter")
  await waitFor(() => trigger.getAttribute("aria-expanded") !== "true")
  // A closed popup can stay mounted, so wait until no option is visible.
  await waitFor(() => visibleOptions().length === 0)
}

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
      if (scenario !== "results") return
      void (async () => {
        await nextFrame()
        const triggers = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role='combobox'][aria-label^='Role for']",
          ),
        )
        const labels = ["Team admin", "Viewer", "Billing admin", "User admin"]
        for (const [index, trigger] of triggers.entries()) {
          await chooseRole(trigger, labels[index])
        }
        const button = Array.from(document.querySelectorAll("button")).find(
          (item) => item.textContent?.includes("Send invites"),
        )
        button?.click()
      })()
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
