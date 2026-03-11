import { Superserve } from "@superserve/sdk"
import { Badge } from "@superserve/ui"
import { useCallback, useEffect, useState } from "react"
import ChatArea from "../components/ChatArea"
import Sidebar from "../components/Sidebar"
import { useSuperserveChat } from "../hooks/useSuperserveChat"
import { useAuth } from "../lib/auth-context"
import type { Agent } from "../types"
import { agentStatusBadge } from "../utils"

const BASE_URL = "/api"

interface ChatPageProps {
  agentId: string
  onBack: () => void
}

export default function ChatPage({ agentId, onBack }: ChatPageProps) {
  const { accessToken, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agentName, setAgentName] = useState<string | null>(null)
  const [agentDepsStatus, setAgentDepsStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    const client = new Superserve({ apiKey: accessToken, baseUrl: BASE_URL })
    client.agents.get(agentId).then(
      (agent: Agent) => {
        setAgentName(agent.name)
        setAgentDepsStatus(agent.depsStatus)
      },
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
    retryLastMessage,
  } = useSuperserveChat({
    agentId,
    agentName: agentName ?? agentId,
    // biome-ignore lint/style/noNonNullAssertion: accessToken is checked before this component renders
    accessToken: accessToken!,
    baseUrl: BASE_URL,
  })

  const handleNewChat = useCallback(() => {
    createSession()
    setSidebarOpen(false)
  }, [createSession])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault()
        handleNewChat()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleNewChat])

  const handleSelectSession = (localId: string) => {
    switchSession(localId)
    setSidebarOpen(false)
  }

  const agentBadge = agentDepsStatus ? agentStatusBadge(agentDepsStatus) : null

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
              type="button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="cursor-pointer p-1.5 text-muted transition-colors hover:text-ink md:hidden"
              aria-label="Toggle sidebar"
            >
              <svg
                aria-hidden="true"
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
                type="button"
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
          <div className="flex items-center gap-2">
            {agentBadge && agentDepsStatus !== "ready" && (
              <Badge
                dot
                variant={agentBadge.variant}
                className="font-mono text-[10px] uppercase tracking-wider"
              >
                {agentBadge.label}
              </Badge>
            )}
            <Badge
              dot
              variant={statusVariant}
              className={`font-mono uppercase tracking-wider ${isActive ? "[&>span:first-child]:animate-pulse-dot" : ""}`}
            >
              {statusLabel}
            </Badge>
          </div>
        </div>
      </header>

      {/* Content — sidebar + chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop: fixed, mobile: overlay */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop */}
        <div
          className={`fixed inset-0 z-30 bg-black/20 transition-opacity md:hidden ${
            sidebarOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          role="presentation"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={() => {}}
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
            agentName={agentName ?? undefined}
            onSend={sendMessage}
            onStop={stopStream}
            onRetry={retryLastMessage}
          />
        </div>
      </div>
    </div>
  )
}
