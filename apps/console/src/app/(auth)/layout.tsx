import type { Metadata } from "next"

import { FingerprintAccountDeviceObserver } from "@/components/fingerprint-account-device-observer"
import { FingerprintSignupObserver } from "@/components/fingerprint-signup-observer"
import { configuredRegions } from "@/lib/cells"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <FingerprintSignupObserver />
      {/* Plan selection and checkout are reached here before the dashboard.
          No cookie reads in this layout: they would render every auth page
          per request, showing the form before it is interactive. */}
      <FingerprintAccountDeviceObserver
        regions={configuredRegions().join(",")}
      />
      {/* The one main landmark for every auth page; pages must not add another. */}
      <main>{children}</main>
    </>
  )
}
