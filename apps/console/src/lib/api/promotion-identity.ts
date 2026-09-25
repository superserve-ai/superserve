import type { User } from "@supabase/supabase-js"

import { cellFor } from "@/lib/cells"

const MAX_OBSERVATION_AGE_MS = 5 * 60_000
const MAX_FUTURE_SKEW_MS = 30_000
const PUBLICATION_OPERATION = "upsert_profile_with_promotion_identity"

type FailureKind =
  | "actor_mismatch"
  | "observation_unavailable"
  | "schema_unavailable"
  | "invalid_evidence"
  | "authority_unavailable"
  | "persistence_failed"
  | "transport_failed"
  | "invalid_response"

function fail(region: string, error: FailureKind, message: string): never {
  console.error("Promotion identity publication failed", {
    operation: PUBLICATION_OPERATION,
    cell: region === "use" || region === "usw" ? region : "unknown",
    error,
  })
  throw new Error(message)
}

/** Publish one full, authenticated Auth observation to the team's cell. */
export async function publishPromotionIdentity(
  region: string,
  actorId: string,
  user: User,
  observedAt: string,
): Promise<void> {
  if (user.id !== actorId) {
    fail(region, "actor_mismatch", "Promotion identity actor mismatch")
  }
  if (typeof user.updated_at !== "string") {
    fail(
      region,
      "observation_unavailable",
      "Promotion identity observation unavailable; please retry",
    )
  }
  const observed = Date.parse(observedAt)
  const revision = Date.parse(user.updated_at)
  const now = Date.now()
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(revision) ||
    observed < now - MAX_OBSERVATION_AGE_MS ||
    observed > now + MAX_FUTURE_SKEW_MS
  ) {
    fail(
      region,
      "observation_unavailable",
      "Promotion identity observation unavailable; please retry",
    )
  }

  const { data, error } = await Promise.resolve()
    .then(() =>
      cellFor(region)
        .createAdminClient()
        .rpc(PUBLICATION_OPERATION, {
          p_user_id: actorId,
          p_email: user.email ?? null,
          p_email_verified: !!user.email && !!user.email_confirmed_at,
          p_auth_updated_at: user.updated_at,
          p_observed_at: observedAt,
        }),
    )
    .catch(() =>
      fail(
        region,
        "transport_failed",
        "Promotion identity publication failed; please retry",
      ),
    )
  if (error) {
    const kind: FailureKind =
      error.code === "PGRST202" || error.code === "42883"
        ? "schema_unavailable"
        : error.code === "22023"
          ? "invalid_evidence"
          : error.code === "55000"
            ? "authority_unavailable"
            : "persistence_failed"
    fail(region, kind, "Promotion identity publication failed; please retry")
  }
  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    !["applied", "replayed"].includes(data[0]?.outcome) ||
    typeof data[0]?.evidence_version !== "string"
  ) {
    fail(
      region,
      "invalid_response",
      "Promotion identity publication failed; please retry",
    )
  }
}
