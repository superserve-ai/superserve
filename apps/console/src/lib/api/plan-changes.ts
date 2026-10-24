import {
  PLAN_CHANGE_PATHS,
  type PlanChangePreview,
  type PlanChange,
  planChangeSchema,
  planChangePreviewSchema,
} from "./billing-v2"
import { apiClient } from "./client"

export async function previewPlanChange(
  target: string,
  expectedTeam: string,
): Promise<PlanChangePreview> {
  const query = new URLSearchParams({
    target_plan: target,
    expected_team: expectedTeam,
  })
  return planChangePreviewSchema.parse(
    await apiClient<unknown>(`${PLAN_CHANGE_PATHS.preview}?${query}`, {
      cache: "no-store",
    }),
  )
}

export async function schedulePlanChange(
  target: string,
  expectedTeam: string,
  idempotencyKey: string,
  previewToken: string,
  confirmPausesRunning: boolean,
  expectedEffectiveAt?: string,
): Promise<PlanChange> {
  return planChangeSchema.parse(
    await apiClient<unknown>(PLAN_CHANGE_PATHS.schedule, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_plan: target,
        expected_team: expectedTeam,
        idempotency_key: idempotencyKey,
        preview_token: previewToken,
        confirm_pauses_running: confirmPausesRunning,
        expected_effective_at: expectedEffectiveAt,
      }),
    }),
  )
}

export async function undoPlanChange(
  id: string,
  expectedTeam: string,
): Promise<PlanChange> {
  return planChangeSchema.parse(
    await apiClient<unknown>(PLAN_CHANGE_PATHS.undo(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_team: expectedTeam }),
    }),
  )
}
