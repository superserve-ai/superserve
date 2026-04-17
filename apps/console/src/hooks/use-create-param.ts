"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

const PARAM = "create"

export function useCreateParam(): [boolean, (open: boolean) => void] {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpenInternal] = useState(
    () => searchParams.get(PARAM) === "1",
  )

  useEffect(() => {
    if (searchParams.get(PARAM) === "1") setOpenInternal(true)
  }, [searchParams])

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenInternal(next)
      if (!next && searchParams.get(PARAM) === "1") {
        const params = new URLSearchParams(searchParams.toString())
        params.delete(PARAM)
        const qs = params.toString()
        router.replace(qs ? `?${qs}` : window.location.pathname)
      }
    },
    [router, searchParams],
  )

  return [open, setOpen]
}
