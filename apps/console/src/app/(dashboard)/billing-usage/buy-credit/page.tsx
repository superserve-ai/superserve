import type { Metadata } from "next"

import { BuyCreditRoute } from "./route-client"

export const metadata: Metadata = {
  title: "Buy credit",
}

export default function BuyCreditPage() {
  return <BuyCreditRoute />
}
