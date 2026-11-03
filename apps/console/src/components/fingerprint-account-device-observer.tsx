"use client"

import { useVisitorData } from "@fingerprint/react"
import { useEffect } from "react"

import { useUser } from "@/hooks/use-user"
import { recordAccountDevice } from "@/lib/fingerprint/account-device-action"

const RECORDED_KEY = "superserve_account_device_recorded"
// One attempt per page load; a failed one retries on the next visit.
const started = new Set<string>()

/**
 * Records this browser's device once per account and region set, for accounts
 * that predate signup evidence; a newly added region records it again.
 */
export function FingerprintAccountDeviceObserver({
  regions,
}: {
  regions: string
}) {
  if (!process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY) return null

  return <FingerprintAccountDeviceObserverEnabled regions={regions} />
}

function FingerprintAccountDeviceObserverEnabled({
  regions,
}: {
  regions: string
}) {
  const { user } = useUser()
  const { getData } = useVisitorData({ immediate: false })

  useEffect(() => {
    if (!user) return
    const key = `${RECORDED_KEY}:${user.id}:${regions}`
    if (started.has(key)) return
    try {
      if (localStorage.getItem(key)) return
    } catch {
      return
    }
    started.add(key)
    getData({ tag: { device_owner: user.id } })
      .then((result) =>
        result?.event_id
          ? recordAccountDevice(user.id, result.event_id)
          : false,
      )
      .then((recorded) => {
        if (recorded) localStorage.setItem(key, "1")
      })
      .catch(() => {})
  }, [user, getData, regions])

  return null
}
