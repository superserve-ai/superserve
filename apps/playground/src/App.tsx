import { Button } from "@superserve/ui"
import { useRoute } from "./hooks/useRoute"
import { AuthProvider, useAuth } from "./lib/auth-context"
import AgentsPage from "./pages/AgentsPage"
import ChatPage from "./pages/ChatPage"

const CONSOLE_URL = import.meta.env.VITE_CONSOLE_URL as string | undefined

function LoginScreen() {
  const handleConsoleRedirect = () => {
    const returnUrl = window.location.href
    const consoleUrl = CONSOLE_URL || "https://console.superserve.ai"
    window.location.href = `${consoleUrl}/auth/signin?next=${encodeURIComponent(returnUrl)}`
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-xs text-center">
        <p className="mb-6 text-sm text-muted">
          Sign in to access the playground
        </p>
        <Button onClick={handleConsoleRedirect}>Sign in via console</Button>
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
      <AppContent />
    </AuthProvider>
  )
}
