import { FingerprintAccountDeviceObserver } from "@/components/fingerprint-account-device-observer"
import {
  getImpersonationTeamId,
  hasImpersonationCookie,
} from "@/lib/admin/impersonation"
import { configuredRegions } from "@/lib/cells"
import { createServerClient } from "@/lib/supabase/server"

async function impersonating(): Promise<boolean> {
  if (!(await hasImpersonationCookie())) return false
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (await getImpersonationTeamId(user)) !== null
}

/**
 * Never during an authorized impersonation, which would attribute the
 * operator's device; a stale cookie left for another account does not count.
 */
export async function AccountDeviceRecorder() {
  if (await impersonating()) return null
  return (
    <FingerprintAccountDeviceObserver regions={configuredRegions().join(",")} />
  )
}
