import { useState } from "react"
import { Button, TooltipProvider } from "@superserve/ui"
import { useRoute } from "./hooks/useRoute"
import { AuthProvider, useAuth } from "./lib/auth-context"
import AgentsPage from "./pages/AgentsPage"
import ChatPage from "./pages/ChatPage"

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL as string | undefined
const isDev = import.meta.env.DEV

function LoginScreen() {
  const { setDevToken } = useAuth()
  const [token, setToken] = useState("")

  const handleConsoleRedirect = () => {
    const returnUrl = window.location.href
    const consoleUrl = CONSOLE_URL || "https://console.superserve.ai"
    window.location.href = `${consoleUrl}/auth/signin?next=${encodeURIComponent(returnUrl)}`
  }

  const handleDevLogin = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = token.trim()
    if (trimmed) setDevToken(trimmed)
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-xs text-center">
        <p className="mb-6 text-sm text-muted">
          Sign in to access the playground
        </p>
        <Button onClick={handleConsoleRedirect}>Sign in via console</Button>
        {isDev && (
          <form onSubmit={handleDevLogin} className="mt-6 border-t border-dashed border-border pt-6">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              Dev: paste access token
            </p>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token from prod..."
              className="mb-2 h-9 w-full border border-dashed border-border bg-transparent px-3 text-xs text-foreground placeholder:text-muted focus:border-border-focus focus:outline-none"
            />
            <Button type="submit" disabled={!token.trim()} className="w-full">
              Use token
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

function AppContent() {
  const { accessToken, loading } = useAuth()
  const { path, navigate } = useRoute()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    )
  }

  if (!accessToken) {
    return <LoginScreen />
  }

  const agentMatch = path.match(/^\/agents\/([^/]+)/)
  if (agentMatch) {
    return (
      <ChatPage
        key={agentMatch[1]}
        agentId={agentMatch[1]}
        onBack={() => navigate("/agents")}
      />
    )
  }

  return <AgentsPage navigate={navigate} />
}

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <AppContent />
      </TooltipProvider>
    </AuthProvider>
  )
}
