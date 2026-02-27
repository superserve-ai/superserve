import { useState, useEffect } from "react"
import { Superserve } from "@superserve/sdk"
import { Badge } from "@superserve/ui"
import { useSuperserveChat } from "../hooks/useSuperserveChat"
import Sidebar from "../components/Sidebar"
import ChatArea from "../components/ChatArea"
import { useAuth } from "../lib/auth-context"

const BASE_URL = "/api"

interface ChatPageProps {
  agentId: string
  onBack: () => void
}

export default function ChatPage({ agentId, onBack }: ChatPageProps) {
  const { accessToken, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agentName, setAgentName] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    const client = new Superserve({ apiKey: accessToken, baseUrl: BASE_URL })
    client.agents.get(agentId).then(
      (agent) => setAgentName(agent.name),
      (err) => {
        const msg = err instanceof Error ? err.message : ""
        if (
          msg.includes("invalid") ||
          msg.includes("expired") ||
          msg.includes("unauthorized") ||
          msg.includes("401")
        ) {
          signOut()
          return
        }
        setAgentName(null)
      },
    )
  }, [agentId, accessToken, signOut])

  const {
    sessions,
    activeSession,
    activeLocalId,
    status,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    stopStream,
  } = useSuperserveChat({
    agentId,
    agentName: agentName ?? agentId,
    accessToken: accessToken!,
    baseUrl: BASE_URL,
  })

  const handleNewChat = () => {
    createSession()
    setSidebarOpen(false)
  }

  const handleSelectSession = (localId: string) => {
    switchSession(localId)
    setSidebarOpen(false)
  }

  const isActive = status === "streaming"
  const statusLabel = isActive
    ? "Streaming"
    : status === "error"
      ? "Error"
      : "Ready"

  const statusVariant = isActive
    ? "warning"
    : status === "error"
      ? "destructive"
      : ("success" as const)

  return (
    <div className="flex h-full flex-col text-sm text-foreground">
      {/* Header */}
      <header className="border-b border-dashed border-border bg-background">
        <div className="flex h-14 items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="cursor-pointer p-1.5 text-muted transition-colors hover:text-ink md:hidden"
              aria-label="Toggle sidebar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3" y1="4.5" x2="15" y2="4.5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13.5" x2="15" y2="13.5" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="hidden text-muted md:inline">Superserve</span>
              <span className="hidden text-ink-faint md:inline">/</span>
              <button
                onClick={onBack}
                className="cursor-pointer text-muted transition-colors hover:text-ink-light"
              >
                Playground
              </button>
              <span className="text-ink-faint">/</span>
              <span
                className={`font-medium ${agentName ? "text-foreground" : "animate-pulse font-mono text-muted"}`}
              >
                {agentName ?? agentId}
              </span>
            </div>
          </div>
          <Badge
            dot
            variant={statusVariant}
            className={`font-mono uppercase tracking-wider ${isActive ? "[&>span:first-child]:animate-pulse-dot" : ""}`}
          >
            {statusLabel}
          </Badge>
        </div>
      </header>

      {/* Content — sidebar + chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop: fixed, mobile: overlay */}
        <div
          className={`fixed inset-0 z-30 bg-black/20 transition-opacity md:hidden ${
            sidebarOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform md:static md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            sessions={sessions}
            activeLocalId={activeLocalId}
            onNewChat={handleNewChat}
            onSelectSession={handleSelectSession}
            onDeleteSession={deleteSession}
          />
        </div>

        {/* Chat area */}
        <div className="flex-1">
          <ChatArea
            session={activeSession}
            status={status}
            onSend={sendMessage}
            onStop={stopStream}
          />
        </div>
      </div>
    </div>
  )
}
