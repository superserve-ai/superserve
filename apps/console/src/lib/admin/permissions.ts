import type { User } from "@supabase/supabase-js"

const USERS_READ_PERMISSION = "users:read"

function userPermissions(user: User | null | undefined): string[] {
  const permissions = user?.app_metadata?.permissions
  return Array.isArray(permissions) ? (permissions as string[]) : []
}

export function canViewOtherUsersAccount(
  user: User | null | undefined,
): boolean {
  return userPermissions(user).includes(USERS_READ_PERMISSION)
}
