import { createContext, useContext, type ReactNode } from "react"

interface SuperserveContextValue {
  apiKey?: string
  baseUrl?: string
}

const SuperserveContext = createContext<SuperserveContextValue | null>(null)

export interface SuperserveProviderProps {
  /** API key for authentication. This is the same token you get from `superserve login`. */
  apiKey?: string
  /** Base URL for the Superserve API. */
  baseUrl?: string
  children: ReactNode
}

/**
 * Provides Superserve configuration to all child useAgent hooks.
 *
 * @example
 * ```tsx
 * import { SuperserveProvider } from 'superserve/react'
 *
 * function App() {
 *   return (
 *     <SuperserveProvider>
 *       <Chat />
 *     </SuperserveProvider>
 *   )
 * }
 * ```
 */
export function SuperserveProvider({
  apiKey,
  baseUrl,
  children,
}: SuperserveProviderProps) {
  return (
    <SuperserveContext.Provider value={{ apiKey, baseUrl }}>
      {children}
    </SuperserveContext.Provider>
  )
}

/** @internal */
export function useSuperserveContext(): SuperserveContextValue | null {
  return useContext(SuperserveContext)
}
