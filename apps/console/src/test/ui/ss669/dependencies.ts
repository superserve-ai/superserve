"use client"

import type { TeamDirectoryResponse } from "../../../lib/api/teams-actions"

export function useUser() {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000669",
      email: "storage-ui@example.test",
      user_metadata: { full_name: "Storage UI fixture" },
      app_metadata: { provider: "google" },
    },
    loading: false,
    error: null,
  }
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  return {
    teams: [
      { id: "storage-ui-team", name: "Storage UI fixture", region: "use" },
    ],
    regions: ["use"],
    activeTeamId: "storage-ui-team",
    activeRegion: "use",
  }
}

function unsupported(): never {
  throw new Error(
    "This read-only UI fixture does not support mutations or legacy billing",
  )
}

export const createTeamAction = unsupported
export const setActiveTeamAction = unsupported
export const getBillingUsageAction = unsupported
export function createBrowserClient() {
  return { auth: { updateUser: unsupported, signInWithPassword: unsupported } }
}

export function usePostHog() {
  return { capture: () => {} }
}
