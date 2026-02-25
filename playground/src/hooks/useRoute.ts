import { useState, useEffect, useCallback } from "react"

export function useRoute() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, "", to)
    setPath(to)
  }, [])

  return { path, navigate }
}
