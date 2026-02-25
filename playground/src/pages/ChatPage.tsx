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

  return (
    <div className="flex h-full">
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
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Chat area */}
      <div className="flex-1">
        <ChatArea
          agentName={agentName ?? agentId}
          session={activeSession}
          status={status}
          onSend={sendMessage}
          onStop={stopStream}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onBack={onBack}
        />
      </div>
    </div>
  )
}
