// TODO(better-auth): Replace Supabase auth with Better Auth

import posthog from "posthog-js"
import { createContext, useContext, useEffect, useState } from "react"

const DEV_TOKEN_KEY = "superserve-dev-token"

interface AuthUser {
  id: string
  email?: string
}

interface AuthSession {
  user: AuthUser
  access_token: string
}

interface AuthContextType {
  user: AuthUser | null
  session: AuthSession | null
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
  const [state, setState] = useState<
    Omit<AuthContextType, "signOut" | "setDevToken">
  >({
    user: null,
    session: null,
    accessToken: null,
    loading: true,
  })

  const signOut = async () => {
    localStorage.removeItem(DEV_TOKEN_KEY)
    // TODO(better-auth): call Better Auth sign out
    if (posthog.__loaded) {
      posthog.reset()
    }
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
      setState({
        user: null,
        session: null,
        accessToken: devToken,
        loading: false,
      })
      return
    }

    // TODO(better-auth): Get session from Better Auth here.
    // For now, no session is available — user will see the login screen
    // and can sign in via console redirect or dev token.
    setState({
      user: null,
      session: null,
      accessToken: null,
      loading: false,
    })
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
