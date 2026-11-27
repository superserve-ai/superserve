"use client"

import {
  Button,
  Field,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Separator,
  useToast,
} from "@superserve/ui"
import { useState } from "react"

import { useCreateTeam, useTeams } from "@/hooks/use-teams"
import {
  GOOGLE_SIGNUP_RECOVERY_URL,
  requiresGoogleSignupRecovery,
} from "@/lib/api/client"
import { regionLabel } from "@/lib/format"

/**
 * Team directory + create-team form. The directory marks the active team;
 * switching lives in the sidebar dropdown.
 * Users with at most one team can create another to leave their current team.
 *
 * While the active team is the user's own account team, creating a team
 * converts that account in its own region instead of adding another team.
 * The conversion needs no region choice, so it shows with any number of
 * cells.
 */
export function TeamsSection() {
  const { data } = useTeams()
  const createTeam = useCreateTeam()
  const { addToast } = useToast()

  const [name, setName] = useState("")
  const [region, setRegion] = useState("use")

  const conversion =
    data?.convertibleTeams?.find(
      (t) => t.id === data.activeTeamId && t.region === data.activeRegion,
    ) ?? null
  if (!data) return null
  const canCreate =
    conversion !== null || data.regions.length > 1 || data.teams.length <= 1

  const handleCreate = () => {
    createTeam.mutate(
      conversion
        ? { name, region: conversion.region, convertTeamId: conversion.id }
        : {
            name,
            region:
              data.regions.length > 1 ? region : (data.regions[0] ?? "use"),
          },
      {
        onSuccess: ({ team, converted }) => {
          setName("")
          addToast(
            converted
              ? `Your account is now the team ${team.name}`
              : `Team ${team.name} created in ${regionLabel(team.region)}`,
            "success",
          )
        },
        onError: (error) => {
          if (requiresGoogleSignupRecovery(error)) {
            window.location.assign(GOOGLE_SIGNUP_RECOVERY_URL)
            return
          }
          addToast(error.message || "Failed to create team", "error")
        },
      },
    )
  }

  return (
    <>
      <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
        <div>
          <h2 className="text-base font-medium text-foreground">Teams</h2>
          <p className="mt-1 text-xs text-muted">
            Your teams and their primary region.
          </p>
        </div>
        <div className="max-w-md space-y-5">
          <div className="border border-dashed border-border">
            {data.teams.map((team) => {
              const isActive =
                team.id === data.activeTeamId &&
                team.region === data.activeRegion
              return (
                <div
                  key={`${team.region}:${team.id}`}
                  className="flex items-center justify-between gap-3 border-b border-dashed border-border px-4 py-3 last:border-b-0"
                >
                  <span className="text-sm text-foreground">{team.name}</span>
                  <span className="flex items-center gap-3">
                    {/* Switching lives in the sidebar team dropdown; this
                        directory only marks which team is active. */}
                    {isActive && (
                      <span className="font-mono text-xs text-brand uppercase">
                        Active
                      </span>
                    )}
                    <span className="font-mono text-xs text-muted uppercase">
                      {regionLabel(team.region)}
                    </span>
                  </span>
                </div>
              )
            })}
            {data.teams.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted">No teams yet.</p>
            )}
          </div>
          {canCreate && (
            <>
              <Field label={conversion ? "Team Name" : "New Team Name"}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-team"
                />
              </Field>
              {conversion ? (
                <p className="text-xs text-muted">
                  Your current account becomes this team in{" "}
                  {regionLabel(conversion.region)}. Its sandboxes, API keys,
                  plan, and billing stay the same.
                </p>
              ) : data.regions.length > 1 ? (
                <Field label="Region">
                  <Select
                    value={region}
                    onValueChange={(v) => setRegion(v as string)}
                  >
                    <SelectTrigger aria-label="Team region">
                      <SelectValue>{() => regionLabel(region)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {data.regions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {regionLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              ) : null}
              <div>
                <Button
                  onClick={handleCreate}
                  disabled={!name.trim() || createTeam.isPending}
                  size="sm"
                >
                  {createTeam.isPending ? "Creating..." : "Create Team"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Separator />
    </>
  )
}
