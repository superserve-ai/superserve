export interface OfferTermsView {
  title: string
  currency: string
  annualFeeCents: number
  firstFeeWaived: boolean
  termMonths: number
  allowances: Array<{
    firstMonth: number
    lastMonth: number
    monthlyCents: number
  }>
  expiration: string
  overage: string
  renewal: string
  rates: Array<{ resource: string; price: string }>
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100)
}
