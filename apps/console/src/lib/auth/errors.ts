// Supabase wraps Postgres trigger exceptions raised during auth.users INSERT
// as this generic message. Used to detect signups blocked by the
// `reject_blocked_emails` trigger on auth.users.
export const BLOCKED_TRIGGER_MESSAGE = "database error saving new user"
