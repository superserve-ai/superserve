import { useState, useEffect, useRef, useCallback } from "react"

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? (JSON.parse(stored) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(state)
  latestRef.current = state

  // Debounced write to localStorage
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch {
        // localStorage full or unavailable
      }
    }, 300)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [key, state])

  // Flush on unmount
  useEffect(() => {
    return () => {
      try {
        localStorage.setItem(key, JSON.stringify(latestRef.current))
      } catch {
        // ignore
      }
    }
  }, [key])

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(value)
    },
    [],
  )

  return [state, setValue]
}
