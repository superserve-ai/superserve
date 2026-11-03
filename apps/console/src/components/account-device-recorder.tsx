import { FingerprintAccountDeviceObserver } from "@/components/fingerprint-account-device-observer"
import { hasImpersonationCookie } from "@/lib/admin/impersonation"

/** Never during impersonation, which would attribute the operator's device. */
export async function AccountDeviceRecorder() {
  if (await hasImpersonationCookie()) return null
  return <FingerprintAccountDeviceObserver />
}
