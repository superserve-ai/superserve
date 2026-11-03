"use client"

import { useVisitorData } from "@fingerprint/react"
import { useEffect } from "react"

import { useUser } from "@/hooks/use-user"
import { recordAccountDevice } from "@/lib/fingerprint/account-device-action"

const RECORDED_KEY = "superserve_account_device_recorded"
// One attempt per page load; a failed one retries on the next visit.
const started = new Set<string>()

/** Records this browser's device once per account, for accounts that predate signup evidence. */
export function FingerprintAccountDeviceObserver() {
  if (!process.env.NEXT_PUBLIC_FINGERPRINT_API_KEY) return null

  return <FingerprintAccountDeviceObserverEnabled />
}

function FingerprintAccountDeviceObserverEnabled() {
  const { user } = useUser()
  const { getData } = useVisitorData({ immediate: false })

  useEffect(() => {
    if (!user || started.has(user.id)) return
    const key = `${RECORDED_KEY}:${user.id}`
    try {
      if (localStorage.getItem(key)) return
    } catch {
      return
    }
    started.add(user.id)
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
  }, [user, getData])

  return null
}
