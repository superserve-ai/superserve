"use client"

import { createContext, useContext } from "react"

export interface ImpersonationState {
  isImpersonating: boolean
  teamName: string | null
}

const ImpersonationContext = createContext<ImpersonationState>({
  isImpersonating: false,
  teamName: null,
})

interface ProviderProps {
  value: ImpersonationState
  children: React.ReactNode
}

/**
 * Client-readable impersonation state, fed from the server layout (the cookie
 * is HttpOnly so client JS cannot read it directly). Lets client components
 * disable data-plane actions — terminal, file transfer — that bypass the proxy
 * and would otherwise defeat read-only impersonation.
 */
export function ImpersonationStateProvider({ value, children }: ProviderProps) {
  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation(): ImpersonationState {
  return useContext(ImpersonationContext)
}
