import {
  financialRevocationMessage,
  type FinancialAuthority,
} from "./financial-authority"

export function FinancialRevocation({
  authority,
}: {
  authority: FinancialAuthority | undefined
}) {
  const message = financialRevocationMessage(authority)
  if (!message) return null
  return (
    <section aria-live="polite">
      <h3 className="font-semibold">{message.title}</h3>
      <p>{message.description}</p>
    </section>
  )
}
