"use client"

import { createContext, useContext, useEffect, useState } from "react"

const STORAGE_KEY = "superserve-sidebar-collapsed"

interface SidebarContextValue {
  isCollapsed: boolean
  toggle: () => void
  setCollapsed: (value: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "true") setIsCollapsed(true)
  }, [])

  const setCollapsed = (value: boolean) => {
    setIsCollapsed(value)
    localStorage.setItem(STORAGE_KEY, String(value))
  }

  const toggle = () => setCollapsed(!isCollapsed)

  return (
    <SidebarContext value={{ isCollapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
