"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createServerClient } from "@/lib/supabase/server"

const MAX_USAGE_RANGE_MS = 90 * 24 * 60 * 60 * 1000
const USAGE_DASHBOARD_FLAG = "tenant_usage_dashboard"
const BILLING_METRICS_WRITE_FLAG = "billing_metrics_write"
const BILLING_EXPORT_FLAG = "billing_export_enabled"

export interface BillingUsageHourly {
  hour_start: string
  hour_end: string
  vcpu_seconds: number
  memory_mib_seconds: number
  storage_mib_seconds: number
  updated_at: string
}

export type BillingUsageMode = "disabled" | "preview" | "active"

export interface BillingUsageResponse {
  enabled: boolean
  billing_mode: BillingUsageMode
  period_start: string
  period_end: string
  rows: BillingUsageHourly[]
}

async function getTeamId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("team_member")
    .select("team_id")
    .eq("profile_id", userId)
    .limit(1)
    .single()
  return data?.team_id ?? null
}

function normalizePeriod(periodStart: string, periodEnd: string) {
  const start = new Date(periodStart)
  const requestedEnd = new Date(periodEnd)
  const now = new Date()
  const end = requestedEnd > now ? now : requestedEnd

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid billing usage period")
  }
  if (end <= start) {
    throw new Error("Billing usage period end must be after period start")
  }
  if (end.getTime() - start.getTime() > MAX_USAGE_RANGE_MS) {
    throw new Error("Billing usage period cannot exceed 90 days")
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  }
}

async function getFeatureEnabled(
  teamId: string,
  flagKey: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data: enabled, error } = await admin.rpc("feature_enabled", {
    flag_key: flagKey,
    flag_team_id: teamId,
  })
  if (error) throw new Error(error.message)
  return Boolean(enabled)
}

function numericToNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  return 0
}

export async function getBillingUsageAction(
  periodStart: string,
  periodEnd: string,
): Promise<BillingUsageResponse> {
  const period = normalizePeriod(periodStart, periodEnd)

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const teamId = await getTeamId(user.id)
  if (!teamId) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  const dashboardEnabled = await getFeatureEnabled(teamId, USAGE_DASHBOARD_FLAG)
  if (!dashboardEnabled) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  const metricsWriteEnabled = await getFeatureEnabled(
    teamId,
    BILLING_METRICS_WRITE_FLAG,
  )
  if (!metricsWriteEnabled) {
    return {
      enabled: false,
      billing_mode: "disabled",
      period_start: period.periodStart,
      period_end: period.periodEnd,
      rows: [],
    }
  }

  const billingExportEnabled = await getFeatureEnabled(
    teamId,
    BILLING_EXPORT_FLAG,
  )
  const billingMode: BillingUsageMode = billingExportEnabled
    ? "active"
    : "preview"

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("team_billing_usage_hourly")
    .select(
      "hour_start, hour_end, vcpu_seconds, memory_mib_seconds, storage_mib_seconds, updated_at",
    )
    .eq("team_id", teamId)
    .gte("hour_start", period.periodStart)
    .lt("hour_start", period.periodEnd)
    .order("hour_start", { ascending: true })

  if (error) throw new Error(error.message)

  return {
    enabled: true,
    billing_mode: billingMode,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    rows: (data ?? []).map((row) => ({
      hour_start: row.hour_start as string,
      hour_end: row.hour_end as string,
      vcpu_seconds: numericToNumber(row.vcpu_seconds),
      memory_mib_seconds: numericToNumber(row.memory_mib_seconds),
      storage_mib_seconds: numericToNumber(row.storage_mib_seconds),
      updated_at: row.updated_at as string,
    })),
  }
}
