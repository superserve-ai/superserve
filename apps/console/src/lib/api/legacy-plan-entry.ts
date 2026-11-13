import "server-only"
import type { cellFor } from "@/lib/cells"

export async function hasLegacyPlanEntry(
  admin: ReturnType<ReturnType<typeof cellFor>["createAdminClient"]>,
  teamId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("billing_legacy_plan_entry")
    .select("team_id")
    .eq("team_id", teamId)
    .maybeSingle()
  // Cells without the migration have no legacy teams entering paid plans yet.
  if (error && error.code !== "42P01" && error.code !== "PGRST205")
    throw new Error("Unable to check your plan. Please retry.")
  return !error && !!data
}
