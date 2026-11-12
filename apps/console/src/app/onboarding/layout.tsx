import { FingerprintAccountDeviceObserver } from "@/components/fingerprint-account-device-observer"
import { configuredRegions } from "@/lib/cells"

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <FingerprintAccountDeviceObserver
        regions={configuredRegions().join(",")}
      />
      {children}
    </>
  )
}
