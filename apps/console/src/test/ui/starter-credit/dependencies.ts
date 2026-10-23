"use client"

import type { TeamDirectoryResponse } from "../../../lib/api/teams-actions"

export function useUser() {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000759",
      email: "starter-ui@example.test",
      user_metadata: { full_name: "Starter UI fixture" },
      app_metadata: { provider: "google" },
    },
    loading: false,
    error: null,
  }
}

export async function listTeamsAction(): Promise<TeamDirectoryResponse> {
  return {
    teams: [{ id: "starter-ui-team", name: "Example team", region: "use" }],
    regions: ["use"],
    activeTeamId: "starter-ui-team",
    activeRegion: "use",
  }
}

export async function getPublicBillingPlansAction(): Promise<{
  pricing_version: "v2"
}> {
  return { pricing_version: "v2" }
}

function unsupported(): never {
  throw new Error("This UI fixture does not support this action")
}

export const createTeamAction = unsupported
export const setActiveTeamAction = unsupported
export function createBrowserClient() {
  return { auth: { updateUser: unsupported, signInWithPassword: unsupported } }
}

export function usePostHog() {
  return { capture: () => {} }
}
