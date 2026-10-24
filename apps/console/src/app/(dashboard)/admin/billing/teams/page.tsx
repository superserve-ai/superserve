import { UsersIcon } from "@phosphor-icons/react/dist/ssr"
import {
  Alert,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { AdminBillingRequestError } from "@/lib/admin/billing-api"
import { BILLING_TEAMS_PAGE, listBillingTeams } from "@/lib/admin/team-billing"
import { regionLabel } from "@/lib/format"

import { formatUsd } from "./format"

export default async function AdminBillingTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const { q } = await searchParams
  const search = typeof q === "string" ? q.trim().slice(0, 200) : ""
  let result: Awaited<ReturnType<typeof listBillingTeams>>
  try {
    result = await listBillingTeams(search)
  } catch (error) {
    if (error instanceof AdminBillingRequestError) {
      return (
        <EmptyState
          icon={UsersIcon}
          title="Team billing is unavailable"
          description="Billing details could not be loaded. Try again shortly."
        />
      )
    }
    throw error
  }
  const { teams, unavailableRegions, hiddenTeams, allRegionsUnavailable } =
    result
  if (allRegionsUnavailable) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="Team billing is unavailable"
        description="Billing details could not be loaded. Try again shortly."
      />
    )
  }

  return (
    <div className="flex flex-col">
      <form className="flex items-center gap-2 border-b border-dashed border-border px-4 py-3">
        <Input
          name="q"
          defaultValue={search}
          placeholder="Search teams by name"
          aria-label="Search teams"
          className="max-w-sm"
        />
      </form>
      {unavailableRegions.length > 0 ? (
        <Alert variant="warning" className="m-4">
          Teams in {unavailableRegions.map(regionLabel).join(", ")} could not be
          loaded.
        </Alert>
      ) : null}
      {hiddenTeams > 0 ? (
        <p className="px-4 pt-3 text-xs text-muted">
          Showing the first {BILLING_TEAMS_PAGE} teams per region; {hiddenTeams}{" "}
          more match. Search by name to find a team.
        </p>
      ) : null}
      {teams.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No teams"
          description={
            search ? "No teams match this search." : "No teams to show."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Current charges</TableHead>
              <TableHead>Credits remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => (
              <TableRow key={`${team.region}:${team.teamId}`}>
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/billing/teams/${team.teamId}?region=${encodeURIComponent(team.region)}`}
                    className="hover:underline"
                  >
                    {team.teamName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted">
                  {regionLabel(team.region)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {team.currentChargesUsd === null
                    ? "—"
                    : formatUsd(team.currentChargesUsd)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {team.creditsRemainingUsd === null
                    ? "—"
                    : formatUsd(team.creditsRemainingUsd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
