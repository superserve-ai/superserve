import type { RenameTeamResult } from "@/lib/api/team-rename-actions"

export class RenameTeamActionFailure extends Error {
  constructor(
    readonly code: Extract<RenameTeamResult, { ok: false }>["code"],
    message: string,
  ) {
    super(message)
  }
}
