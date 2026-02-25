import { useRoute } from "./hooks/useRoute"
import AgentsPage from "./pages/AgentsPage"
import ChatPage from "./pages/ChatPage"

const BASE_URL = "/api"

export default function App() {
  const apiKey = import.meta.env.VITE_SUPERSERVE_API_KEY as string | undefined
  const { path, navigate } = useRoute()

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

  // Route: /agents/:agentId
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

  // Route: / or /agents
  return <AgentsPage apiKey={apiKey} baseUrl={BASE_URL} navigate={navigate} />
}
