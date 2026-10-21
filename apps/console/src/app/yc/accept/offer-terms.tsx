import { money, type OfferTermsView } from "@/lib/yc/offer-view"

export function OfferTerms({ terms }: { terms: OfferTermsView }) {
  return (
    <section
      className="space-y-5 border border-dashed border-border p-6"
      aria-label="Approved offer terms"
    >
      <h2 className="text-xl font-semibold">{terms.title}</h2>
      <p>
        {terms.termMonths} months of Pro. Annual fee:{" "}
        {money(terms.annualFeeCents, terms.currency)}.
        {terms.firstFeeWaived ? " Your first annual fee is fully waived." : ""}
      </p>
      <table className="w-full text-left">
        <caption className="pb-3 text-left font-semibold">
          Your monthly usage credits
        </caption>
        <thead>
          <tr className="border-b border-dashed border-border">
            <th scope="col" className="py-2">
              Offer months
            </th>
            <th scope="col">Credits each month</th>
          </tr>
        </thead>
        <tbody>
          {terms.allowances.map((allowance) => (
            <tr
              key={allowance.firstMonth}
              className="border-b border-dashed border-border"
            >
              <th scope="row" className="py-2 font-normal">
                {allowance.firstMonth}–{allowance.lastMonth}
              </th>
              <td>{money(allowance.monthlyCents, terms.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{terms.expiration}</p>
      <h3 className="font-semibold">Usage and payment</h3>
      <p>{terms.overage}</p>
      <h3 className="font-semibold">At the end of your offer</h3>
      <p>{terms.renewal}</p>
      <details>
        <summary className="cursor-pointer underline">
          Resource rates for this offer
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {terms.rates.map((rate) => (
            <div key={rate.resource}>
              <dt>{rate.resource}</dt>
              <dd>{rate.price}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
