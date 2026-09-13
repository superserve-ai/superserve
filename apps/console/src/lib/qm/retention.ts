/**
 * How long a deleted stack's data is kept before it is erased for good.
 * qm-api neither exposes nor enforces a window itself, so this is shared
 * deployment configuration: leave it unset and the console promises
 * nothing beyond "deleted"; set it only when the backing platform honours
 * that retention. Read at call time; the env name must stay a literal for
 * Next.js to inline it.
 */
export function qmRetentionDays(): number | null {
  const raw = process.env.NEXT_PUBLIC_QM_RETENTION_DAYS?.trim()
  if (!raw) return null
  const days = Number(raw)
  return Number.isInteger(days) && days > 0 ? days : null
}
