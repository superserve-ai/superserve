import { useState } from "react"
import { useSuperserveChat } from "./hooks/useSuperserveChat"
import Sidebar from "./components/Sidebar"
import ChatArea from "./components/ChatArea"

function ChatApp({ apiKey }: { apiKey: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
    agentName: "post-generator-agent",
    apiKey,
    baseUrl: "/api",
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
          session={activeSession}
          status={status}
          onSend={sendMessage}
          onStop={stopStream}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />
      </div>
    </div>
  )
}

export default function App() {
  const apiKey = import.meta.env.VITE_SUPERSERVE_API_KEY as string | undefined

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center p-8 font-mono">
        <div className="max-w-md rounded-lg border border-neutral-200 p-6 text-[13px]">
          <p className="font-semibold">Missing API key</p>
          <p className="mt-2 leading-relaxed text-neutral-500">
            Set{" "}
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              VITE_SUPERSERVE_API_KEY
            </code>{" "}
            in your environment or create a{" "}
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              .env
            </code>{" "}
            file:
          </p>
          <pre className="mt-3 overflow-auto rounded bg-neutral-900 px-3.5 py-2.5 text-xs text-neutral-300">
            VITE_SUPERSERVE_API_KEY=ss_...
          </pre>
        </div>
      </div>
    )
  }

  return <ChatApp apiKey={apiKey} />
}
