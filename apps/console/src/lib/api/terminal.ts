import { apiClient } from "./client"

export interface TerminalTokenResponse {
  token: string
  url: string
  subprotocol: string
  expires_at: string
}

export async function mintTerminalToken(
  sandboxId: string,
): Promise<TerminalTokenResponse> {
  return apiClient<TerminalTokenResponse>(
    `/sandboxes/${sandboxId}/terminal-token`,
    { method: "POST" },
  )
}
