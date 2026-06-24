import { notFound } from "next/navigation"

import { isTeamManagementServerEnabled } from "@/lib/feature-flags"

import { UserManagementClient } from "./user-management-client"

export default function UserManagementPage() {
  if (!isTeamManagementServerEnabled()) {
    notFound()
  }

  return <UserManagementClient />
}
