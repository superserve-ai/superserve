"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

export const SMALL_SCREEN_MEDIA_QUERY = "(width < 48rem)"

const STORAGE_KEY = "superserve-sidebar-collapsed"

function getSmallScreenMediaQuery() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined
  }
  return window.matchMedia(SMALL_SCREEN_MEDIA_QUERY)
}

function subscribeToSmallScreen(onChange: () => void) {
  const mediaQuery = getSmallScreenMediaQuery()
  mediaQuery?.addEventListener("change", onChange)
  return () => mediaQuery?.removeEventListener("change", onChange)
}

function useIsSmallScreen() {
  return useSyncExternalStore(
    subscribeToSmallScreen,
    () => getSmallScreenMediaQuery()?.matches ?? false,
    () => false,
  )
}

interface SidebarContextValue {
  isCollapsed: boolean
  isOverlayOpen: boolean
  toggle: () => void
  toggleRef: React.RefObject<HTMLButtonElement | null>
  closeOverlay: (focusFrom?: HTMLElement | null) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isSmallScreen = useIsSmallScreen()
  const pathname = usePathname()
  const [previous, setPrevious] = useState({ pathname, isSmallScreen })
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const focusAfterCloseRef = useRef<{ from?: HTMLElement | null } | null>(null)
  const [storedCollapsed, setStoredCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(STORAGE_KEY) === "true"
  })

  if (
    pathname !== previous.pathname ||
    isSmallScreen !== previous.isSmallScreen
  ) {
    setPrevious({ pathname, isSmallScreen })
    setMobileExpanded(false)
  }

  const isCollapsed = isSmallScreen ? !mobileExpanded : storedCollapsed
  const isOverlayOpen = isSmallScreen && !isCollapsed

  const closeOverlay = useCallback(
    (focusFrom?: HTMLElement | null) => {
      if (!isOverlayOpen) return
      focusAfterCloseRef.current = { from: focusFrom }
      setMobileExpanded(false)
    },
    [isOverlayOpen],
  )

  useLayoutEffect(() => {
    const focusRequest = focusAfterCloseRef.current
    if (!isOverlayOpen) focusAfterCloseRef.current = null

    const toggleButton = toggleRef.current
    if (!isSmallScreen || !toggleButton) return

    const activeElement = document.activeElement
    if (
      !isOverlayOpen &&
      focusRequest &&
      (!activeElement?.isConnected ||
        activeElement === document.body ||
        toggleButton.closest("aside")?.contains(activeElement) ||
        focusRequest.from?.contains(activeElement))
    ) {
      toggleButton.focus({ preventScroll: true })
    }

    if (document.activeElement === toggleButton) {
      toggleButton.scrollIntoView({ block: "nearest", behavior: "instant" })
    }
  }, [isOverlayOpen, isSmallScreen])

  const setCollapsed = useCallback(
    (value: boolean) => {
      if (isSmallScreen) {
        setMobileExpanded(!value)
        return
      }
      setStoredCollapsed(value)
      localStorage.setItem(STORAGE_KEY, String(value))
    },
    [isSmallScreen],
  )

  const toggle = useCallback(
    () => setCollapsed(!isCollapsed),
    [isCollapsed, setCollapsed],
  )

  const value = useMemo(
    () => ({ isCollapsed, isOverlayOpen, toggle, toggleRef, closeOverlay }),
    [isCollapsed, isOverlayOpen, toggle, closeOverlay],
  )

  return <SidebarContext value={value}>{children}</SidebarContext>
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
