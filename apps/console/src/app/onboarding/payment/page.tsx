import type { Metadata } from "next"
import { Suspense } from "react"

import { PaymentWait } from "./payment-wait"

export const metadata: Metadata = {
  title: "Processing payment | Superserve",
  robots: { index: false, follow: false },
}

export default function PaymentPage() {
  return (
    <Suspense>
      <PaymentWait />
    </Suspense>
  )
}
