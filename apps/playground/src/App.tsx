import { Alert } from "@superserve/ui"
import { useRoute } from "./hooks/useRoute"
import AgentsPage from "./pages/AgentsPage"
import ChatPage from "./pages/ChatPage"

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined

export default function App() {
  const apiKey = import.meta.env.VITE_SUPERSERVE_API_KEY as string | undefined
  const { path, navigate } = useRoute()

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <Alert variant="warning" title="Missing API key" className="max-w-md">
          <p className="mt-1 leading-relaxed">
            Set{" "}
            <code className="bg-surface-hover px-1.5 py-0.5 font-mono text-xs">
              VITE_SUPERSERVE_API_KEY
            </code>{" "}
            in your environment or create a{" "}
            <code className="bg-surface-hover px-1.5 py-0.5 font-mono text-xs">
              .env
            </code>{" "}
            file:
          </p>
          <pre className="mt-3 overflow-auto border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-xs text-neutral-300">
            VITE_SUPERSERVE_API_KEY=ss_...
          </pre>
        </Alert>
      </div>
    )
  }

  const agentMatch = path.match(/^\/agents\/([^/]+)/)
  if (agentMatch) {
    return (
      <ChatPage
        key={agentMatch[1]}
        agentId={agentMatch[1]}
        apiKey={apiKey}
        onBack={() => navigate("/agents")}
      />
    )
  }

  return <AgentsPage apiKey={apiKey} baseUrl={BASE_URL} navigate={navigate} />
}
