import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { serializeTeamSelection } from "@/lib/api/active-team"
import { findActiveTeamForUser } from "@/lib/api/api-key-mint"
import { listTeamsForUser } from "@/lib/api/team-directory"
import {
  findPendingDeviceCode,
  normalizeUserCode,
} from "@/lib/auth/device-login"
import { createServerClient } from "@/lib/supabase/server"

import { DeviceApproval } from "./device-approval"

function DeviceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
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
        <div className="w-full max-w-sm">
          <div className="border border-dashed border-border bg-surface p-8 text-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function Unavailable({ title }: { title: string }) {
  return (
    <DeviceCard>
      <h1 className="mb-4 text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted">
        Run{" "}
        <code className="bg-background px-2 py-1 text-xs">
          superserve login
        </code>{" "}
        in your terminal to get a new code.
      </p>
    </DeviceCard>
  )
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>
}) {
  const { code } = await searchParams
  const userCode = normalizeUserCode(Array.isArray(code) ? code[0] : code)
  if (!userCode) return <Unavailable title="Invalid code" />

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    redirect(
      `/auth/signin?next=${encodeURIComponent(`/device?code=${userCode}`)}`,
    )

  const pending = await findPendingDeviceCode(userCode)
  if (!pending) return <Unavailable title="Code expired or already used" />

  // New accounts have no team yet; approving creates one.
  const { active } = await findActiveTeamForUser(user.id)
  const team = active
    ? {
        key: serializeTeamSelection(active),
        name:
          (await listTeamsForUser(user.id)).find(
            (t) => t.id === active.teamId && t.region === active.region,
          )?.name ?? null,
      }
    : null

  return (
    <DeviceCard>
      <DeviceApproval
        userCode={userCode}
        clientName={pending.clientName}
        email={user.email ?? ""}
        team={team}
      />
    </DeviceCard>
  )
}
