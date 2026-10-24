import type { Metadata } from "next"

import { UpgradePage } from "@/components/billing/upgrade-page"

export const metadata: Metadata = {
  title: "Change plan",
}

export default function Page() {
  return <UpgradePage />
}
