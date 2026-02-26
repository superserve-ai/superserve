import { useState, useEffect } from "react"
import { Superserve } from "@superserve/sdk"
import { useSuperserveChat } from "../hooks/useSuperserveChat"
import Sidebar from "../components/Sidebar"
import ChatArea from "../components/ChatArea"

const BASE_URL = "/api"

interface ChatPageProps {
  agentId: string
  apiKey: string
  onBack: () => void
}

export default function ChatPage({ agentId, apiKey, onBack }: ChatPageProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agentName, setAgentName] = useState<string | null>(null)

  useEffect(() => {
    const client = new Superserve({ apiKey, baseUrl: BASE_URL })
    client.agents.get(agentId).then(
      (agent) => setAgentName(agent.name),
      () => setAgentName(null),
    )
  }, [agentId, apiKey])

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
    apiKey,
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

  return (
    <div className="flex h-full flex-col text-sm text-neutral-900">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="flex h-14 items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="cursor-pointer p-1.5 text-neutral-500 transition-colors hover:text-neutral-700 md:hidden"
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
              <span className="hidden text-neutral-400 md:inline">Superserve</span>
              <span className="hidden text-neutral-300 md:inline">/</span>
              <button
                onClick={onBack}
                className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-600"
              >
                Playground
              </button>
              <span className="text-neutral-300">/</span>
              <span
                className={`font-medium ${agentName ? "text-neutral-900" : "animate-pulse font-mono text-neutral-400"}`}
              >
                {agentName ?? agentId}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${
                isActive
                  ? "animate-pulse-dot bg-amber-500"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-emerald-500"
              }`}
            />
            <span
              className={`font-mono text-[11px] uppercase tracking-wider ${
                isActive
                  ? "text-amber-600"
                  : status === "error"
                    ? "text-red-600"
                    : "text-emerald-600"
              }`}
            >
              {statusLabel}
            </span>
          </div>
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
