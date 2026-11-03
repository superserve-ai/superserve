import { FingerprintAccountDeviceObserver } from "@/components/fingerprint-account-device-observer"
import { hasImpersonationCookie } from "@/lib/admin/impersonation"
import { configuredRegions } from "@/lib/cells"

/** Never during impersonation, which would attribute the operator's device. */
export async function AccountDeviceRecorder() {
  if (await hasImpersonationCookie()) return null
  return (
    <FingerprintAccountDeviceObserver regions={configuredRegions().join(",")} />
  )
}
