"use client"

import { fixtureMode } from "./fixtures"

// Replaces the activity server action (it needs Supabase). Never resolves
// while the fixture is in a loading mode, so the real skeleton stays up.
export async function listActivityBySandboxAction(_sandboxId: string) {
  if (fixtureMode() !== "loaded") return new Promise<never>(() => {})
  return [
    {
      id: "act-1",
      sandbox_id: "sbx-7f3a91c2",
      action: "sandbox.create",
      status: "success",
      duration_ms: 1840,
      created_at: "2026-11-01T09:30:00Z",
    },
  ]
}
