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

export function formatInterval(months: number): string {
  if (months === 1) return "month"
  if (months === 12) return "year"
  return `${months} months`
}

export function formatPlanFee(feeCents: number, months: number): string {
  if (feeCents <= 0) return "No fee"
  return `${formatCents(feeCents)} / ${formatInterval(months)}`
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

export function planLabel(
  offerKey: string,
  options: { offer_key: string; name: string; interval_months: number }[],
): string {
  if (offerKey === "free") return "Pay as you go"
  const option = options.find((o) => o.offer_key === offerKey)
  if (!option) return offerKey
  return `${option.name} ${option.interval_months === 12 ? "annual" : "monthly"}`
}
