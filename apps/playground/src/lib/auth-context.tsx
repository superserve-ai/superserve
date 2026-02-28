import { createContext, useContext, useEffect, useState } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "./supabase"

const DEV_TOKEN_KEY = "superserve-dev-token"

interface AuthContextType {
  user: User | null
  session: Session | null
  accessToken: string | null
  loading: boolean
  signOut: () => Promise<void>
  setDevToken: (token: string) => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  accessToken: null,
  loading: true,
  signOut: async () => {},
  setDevToken: () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthContextType, "signOut" | "setDevToken">>({
    user: null,
    session: null,
    accessToken: null,
    loading: true,
  })

  const signOut = async () => {
    localStorage.removeItem(DEV_TOKEN_KEY)
    await supabase.auth.signOut()
    setState({ user: null, session: null, accessToken: null, loading: false })
  }

  const setDevToken = (token: string) => {
    localStorage.setItem(DEV_TOKEN_KEY, token)
    setState({ user: null, session: null, accessToken: token, loading: false })
  }

  useEffect(() => {
    // Check for dev token first
    const devToken = localStorage.getItem(DEV_TOKEN_KEY)
    if (devToken) {
      setState({ user: null, session: null, accessToken: devToken, loading: false })
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        accessToken: session?.access_token ?? null,
        loading: false,
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        accessToken: session?.access_token ?? null,
        loading: false,
      })
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signOut, setDevToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
