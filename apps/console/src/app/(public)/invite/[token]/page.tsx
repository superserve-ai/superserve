import { Button } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"

import { regionLabel } from "@/lib/format"
import { loadInviteView } from "@/lib/invite/accept"
import { INVITE_COPY } from "@/lib/invite/copy"
import { parseInviteFailure, type InviteView } from "@/lib/invite/decision"
import { knownTeamRole, TEAM_ROLES } from "@/lib/team/roles"

import { beginInviteAuthAction } from "./actions"
import { AutoJoin, ConfirmControls, MismatchControls } from "./invite-controls"

function InviteCard({ children }: { children: React.ReactNode }) {
  // The recorder's block class keeps the token in this page's form fields out
  // of replay even if recording is active during a navigation.
  return (
    <div className="ph-no-capture relative min-h-screen overflow-hidden bg-background">
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

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-4 text-xl font-semibold text-foreground">{children}</h1>
  )
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 text-sm text-muted">{children}</p>
}

function Small({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-xs text-muted">{children}</p>
}

function InviteBody({ view, token }: { view: InviteView; token: string }) {
  switch (view.kind) {
    case "signed_out": {
      const { preview } = view
      const role = knownTeamRole(preview.role)
      return (
        <>
          <Title>{INVITE_COPY.signedOut.title(preview.teamName)}</Title>
          <Body>
            {preview.role
              ? INVITE_COPY.roleInvitation(preview.teamName, preview.role)
              : INVITE_COPY.signedOut.body}
          </Body>
          {preview.role ? (
            role && (
              <p className="mb-6 text-xs text-muted">
                {TEAM_ROLES[role].description}
              </p>
            )
          ) : (
            <p className="mb-6 text-xs text-muted">{INVITE_COPY.ownerNotice}</p>
          )}
          <div className="space-y-3">
            <form action={beginInviteAuthAction.bind(null, token, "signup")}>
              <Button type="submit" className="w-full">
                {INVITE_COPY.signedOut.createAccount}
              </Button>
            </form>
            <form action={beginInviteAuthAction.bind(null, token, "signin")}>
              <Button type="submit" className="w-full" variant="outline">
                {INVITE_COPY.signedOut.signIn}
              </Button>
            </form>
          </div>
          <Small>
            {regionLabel(preview.region)} ·{" "}
            {INVITE_COPY.signedOut.expires(formatInviteDate(preview.expiresAt))}
          </Small>
        </>
      )
    }
    case "confirm": {
      const { preview } = view
      return (
        <>
          <Title>{INVITE_COPY.confirm.title(preview.teamName)}</Title>
          <Body>
            {preview.role
              ? INVITE_COPY.roleInvitation(preview.teamName, preview.role)
              : view.teamless
                ? INVITE_COPY.confirm.bodyNoTeam
                : INVITE_COPY.confirm.body}
          </Body>
          <ConfirmControls token={token} />
          <Small>{regionLabel(preview.region)}</Small>
          <Small>{INVITE_COPY.confirm.signedInAs(view.signedInEmail)}</Small>
          <Small>
            {INVITE_COPY.confirm.notNowKeepsOpen(
              formatInviteDate(preview.expiresAt),
            )}
          </Small>
        </>
      )
    }
    case "mismatch":
      return (
        <>
          <Title>{INVITE_COPY.mismatch.title}</Title>
          <Body>
            {INVITE_COPY.mismatch.body(view.preview.email, view.signedInEmail)}
          </Body>
          <MismatchControls token={token} />
        </>
      )
    case "auto_accept":
      return (
        <>
          <Title>{INVITE_COPY.confirm.title(view.preview.teamName)}</Title>
          {view.preview.role && (
            <Body>
              {INVITE_COPY.roleInvitation(
                view.preview.teamName,
                view.preview.role,
              )}
            </Body>
          )}
          <AutoJoin token={token} />
        </>
      )
    case "not_eligible":
      return (
        <>
          <Title>{INVITE_COPY.notEligible.title}</Title>
          <Body>{INVITE_COPY.notEligible.body}</Body>
          <Button className="w-full" render={<Link href="/sandboxes" />}>
            {INVITE_COPY.notEligible.action}
          </Button>
        </>
      )
    case "already_member":
      return (
        <>
          <Title>
            {INVITE_COPY.alreadyMember.title(view.preview.teamName)}
          </Title>
          <Body>{INVITE_COPY.alreadyMember.body}</Body>
          <Button className="w-full" render={<Link href="/sandboxes" />}>
            {INVITE_COPY.alreadyMember.action}
          </Button>
        </>
      )
    default:
      return (
        <>
          <Title>{INVITE_COPY.unavailable.title}</Title>
          <Body>{INVITE_COPY.unavailable.body}</Body>
          {view.kind === "unavailable" && view.signedIn ? (
            <Button className="w-full" render={<Link href="/sandboxes" />}>
              {INVITE_COPY.unavailable.continue}
            </Button>
          ) : (
            <div className="space-y-3">
              <Button className="w-full" render={<Link href="/auth/signup" />}>
                {INVITE_COPY.unavailable.createAccount}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                render={<Link href="/auth/signin" />}
              >
                {INVITE_COPY.unavailable.signIn}
              </Button>
            </div>
          )}
        </>
      )
  }
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ failed?: string | string[] }>
}) {
  const [{ token }, { failed }] = await Promise.all([params, searchParams])
  const failure = parseInviteFailure(Array.isArray(failed) ? failed[0] : failed)

  // Rendering is read-only. An account that began signup here is joined by a
  // server action, which can set the active-team cookie; nothing here
  // provisions a personal team.
  const { view } = await loadInviteView(token, failure)

  return (
    <InviteCard>
      <InviteBody view={view} token={token} />
    </InviteCard>
  )
}
