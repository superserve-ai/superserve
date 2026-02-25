import { useState, useEffect, useCallback } from "react"
import { Superserve } from "@superserve/sdk"
import type { Agent } from "../types"
import { relativeTime } from "../utils"

interface AgentsPageProps {
  apiKey: string
  baseUrl: string
  navigate: (to: string) => void
}

type LoadingState = "loading" | "error" | "empty" | "loaded"

export default function AgentsPage({
  apiKey,
  baseUrl,
  navigate,
}: AgentsPageProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [state, setState] = useState<LoadingState>("loading")
  const [errorMessage, setErrorMessage] = useState("")

  const fetchAgents = useCallback(async () => {
    setState("loading")
    setErrorMessage("")
    try {
      const client = new Superserve({ apiKey, baseUrl })
      const result = await client.agents.list()
      if (result.length === 0) {
        setState("empty")
      } else {
        setAgents(result)
        setState("loaded")
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load agents",
      )
      setState("error")
    }
  }, [apiKey, baseUrl])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  return (
    <div className="flex h-full flex-col bg-neutral-50 text-sm text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="flex h-14 items-center px-5 md:px-8">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="text-neutral-400">Superserve</span>
            <span className="text-neutral-300">/</span>
            <span className="font-medium text-neutral-900">Playground</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 py-12 md:px-8">
          <h1 className="text-xl font-semibold tracking-tight">Your Agents</h1>
          <p className="mt-1.5 text-[13px] text-neutral-500">
            Select an agent to open the chat playground.
          </p>

          <div className="mt-8">
            {state === "loading" && (
              <div className="divide-y divide-neutral-200 border border-neutral-200">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-white px-5 py-4">
                    <div className="flex-1">
                      <div className="h-4 w-32 animate-pulse bg-neutral-100" />
                      <div className="mt-2 h-3 w-24 animate-pulse bg-neutral-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {state === "error" && (
              <div className="border border-neutral-200 bg-white px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#525252" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="9" cy="9" r="7" />
                    <line x1="9" y1="6" x2="9" y2="9.5" />
                    <circle cx="9" cy="12" r="0.5" fill="#525252" />
                  </svg>
                </div>
                <p className="font-medium">Failed to load agents</p>
                <p className="mt-1 text-[13px] text-neutral-500">{errorMessage}</p>
                <button
                  onClick={fetchAgents}
                  className="mt-4 cursor-pointer bg-neutral-900 px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-white transition-colors hover:bg-neutral-800"
                >
                  Try again
                </button>
              </div>
            )}

            {state === "empty" && (
              <div className="border border-neutral-200 bg-white px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#a3a3a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="14" height="10" />
                    <path d="M6 4V2.5a1.5 1.5 0 013 0V4" />
                    <line x1="9" y1="8" x2="9" y2="11" />
                  </svg>
                </div>
                <p className="font-medium">No agents deployed</p>
                <p className="mt-1 text-[13px] text-neutral-500">
                  Deploy an agent with{" "}
                  <code className="bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
                    superserve deploy
                  </code>{" "}
                  to get started.
                </p>
              </div>
            )}

            {state === "loaded" && (
              <div className="divide-y divide-neutral-200 border border-neutral-200">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    className="group flex w-full cursor-pointer items-center justify-between bg-white px-5 py-4 text-left transition-colors hover:bg-neutral-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{agent.name}</p>
                      <p className="mt-1 text-[12px] text-neutral-400">
                        Updated {relativeTime(agent.updatedAt)}
                      </p>
                    </div>
                    <svg
                      className="shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
