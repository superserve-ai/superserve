import type { Metadata } from "next"

import { AccountDeviceRecorder } from "@/components/account-device-recorder"
import { FingerprintSignupObserver } from "@/components/fingerprint-signup-observer"

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
      {/* Plan selection and checkout are reached here before the dashboard. */}
      <AccountDeviceRecorder />
      {/* The one main landmark for every auth page; pages must not add another. */}
      <main>{children}</main>
    </>
  )
}
