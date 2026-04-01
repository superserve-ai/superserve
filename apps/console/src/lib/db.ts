// TODO(drizzle): Replace stubs with Drizzle + PlanetScale queries

export interface Agent {
  id: string
  name: string
  created_at: string
}

/** Fetch agents for a user, ordered by created_at desc. */
export async function getAgentsByUser(_userId: string): Promise<Agent[]> {
  // TODO(drizzle): implement with Drizzle
  throw new Error("Database not implemented — pending Drizzle + PlanetScale setup")
}

/** Check if a user has any agents. */
export async function userHasAgents(_userId: string): Promise<boolean> {
  // TODO(drizzle): implement with Drizzle
  throw new Error("Database not implemented — pending Drizzle + PlanetScale setup")
}

/** Get an early access request by user ID. Returns null if none exists. */
export async function getEarlyAccessRequest(_userId: string): Promise<{ id: string } | null> {
  // TODO(drizzle): implement with Drizzle
  throw new Error("Database not implemented — pending Drizzle + PlanetScale setup")
}

/** Upsert an early access request for a user. */
export async function upsertEarlyAccessRequest(_data: {
  user_id: string
  name: string
  email: string
  company: string
  role: string
  use_case: string
}): Promise<{ error?: string }> {
  // TODO(drizzle): implement with Drizzle
  return { error: "Database not implemented — pending Drizzle + PlanetScale setup" }
}

/**
 * Subscribe to new agent inserts for a user.
 * Returns an unsubscribe function.
 *
 * Note: Supabase used Postgres realtime for this. With PlanetScale (MySQL),
 * you'll need an alternative approach — polling, SSE from the API, or
 * a websocket connection.
 */
export function subscribeToAgentInserts(
  _userId: string,
  _onInsert: () => void,
): () => void {
  // TODO(drizzle): implement realtime alternative (polling, SSE, etc.)
  console.warn("Agent realtime subscription not implemented")
  return () => {} // noop unsubscribe
}
