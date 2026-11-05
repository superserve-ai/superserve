"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { Button, Field, Input, Separator, useToast } from "@superserve/ui"
import { useState } from "react"

import { useCanRenameTeam, useRenameTeam, useTeams } from "@/hooks/use-teams"
import { teamNameProblem } from "@/lib/api/team-name"
import { regionLabel } from "@/lib/format"

interface ActiveTeam {
  id: string
  name: string
  region: string
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.warn("Failed to copy:", err)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy team ID"}
      className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-foreground transition-colors hover:text-brand"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <CheckIcon className="size-3.5 shrink-0 text-success" weight="light" />
      ) : (
        <CopyIcon className="size-3.5 shrink-0" weight="light" />
      )}
    </button>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-border px-4 py-3 last:border-b-0">
      <dt className="font-mono text-xs text-muted uppercase">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  )
}

function TeamDetailsForm({ team }: { team: ActiveTeam }) {
  const { data: canRename = false } = useCanRenameTeam(team)
  const rename = useRenameTeam()
  const { addToast } = useToast()

  const [name, setName] = useState(team.name)
  const [previousName, setPreviousName] = useState(team.name)
  const [error, setError] = useState<string | undefined>()

  if (team.name !== previousName) {
    setPreviousName(team.name)
    if (name === previousName) setName(team.name)
  }

  const trimmed = name.trim()
  const dirty = trimmed !== team.name

  const handleSave = () => {
    const problem = teamNameProblem(trimmed)
    if (problem) {
      setError(problem)
      return
    }
    setError(undefined)
    rename.mutate(
      { team, name: trimmed },
      {
        onSuccess: (renamed) => {
          setName(renamed.name)
          addToast("Team renamed", "success")
        },
        onError: (err) => setError(err.message || "Failed to rename team."),
      },
    )
  }

  return (
    <div className="max-w-md space-y-5">
      {canRename ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty && !rename.isPending) handleSave()
          }}
        >
          <Field label="Team Name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(undefined)
              }}
              error={error}
              disabled={rename.isPending}
              placeholder="my-team"
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            disabled={!dirty || !trimmed || rename.isPending}
          >
            {rename.isPending ? "Saving..." : "Save Name"}
          </Button>
        </form>
      ) : null}
      <dl className="border border-dashed border-border">
        {!canRename && <DetailRow label="Name">{team.name}</DetailRow>}
        <DetailRow label="Region">{regionLabel(team.region)}</DetailRow>
        <DetailRow label="Team ID">
          <CopyableId value={team.id} />
        </DetailRow>
      </dl>
      {!canRename && (
        <p className="text-xs text-muted">
          You do not have permission to rename this team.
        </p>
      )}
    </div>
  )
}

/**
 * The active team's name, region and ID. Always rendered once the directory
 * resolves an active team; the name is editable only for members whose role
 * allows renaming (decided by the backend capability).
 */
export function TeamDetailsSection() {
  const { data } = useTeams()
  const team = data?.teams.find(
    (t) => t.id === data.activeTeamId && t.region === data.activeRegion,
  )
  if (!team) return null

  return (
    <>
      <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
        <div>
          <h2 className="text-base font-medium text-foreground">Team</h2>
          <p className="mt-1 text-xs text-muted">
            Name and identifiers for your active team.
          </p>
        </div>
        {/* Keyed so switching teams never carries an in-progress edit over. */}
        <TeamDetailsForm key={`${team.region}:${team.id}`} team={team} />
      </div>

      <Separator />
    </>
  )
}
