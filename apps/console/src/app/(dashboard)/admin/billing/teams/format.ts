import type { PlanLimits } from "@/lib/admin/team-billing"

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function formatUsd(amount: number): string {
  return usd.format(amount)
}

export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}

export function formatDay(value: string | number | null): string {
  if (value === null) return "—"
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function gib(mib: number): string {
  return `${Number((mib / 1024).toFixed(1))} GiB`
}

export function describeLimits(limits: Partial<PlanLimits>): string {
  const parts = [
    limits.max_concurrent == null
      ? null
      : `${limits.max_concurrent} running at once`,
    limits.max_vcpu == null ? null : `${limits.max_vcpu} vCPU`,
    limits.max_memory_mib == null ? null : `${gib(limits.max_memory_mib)} RAM`,
    limits.max_disk_mib == null ? null : `${gib(limits.max_disk_mib)} disk`,
    limits.max_templates == null ? null : `${limits.max_templates} templates`,
  ].filter((part) => part !== null)
  return parts.length ? parts.join(" · ") : "Default limits"
}
