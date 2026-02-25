import { useState, useEffect, useCallback } from "react"
import { Superserve } from "@superserve/sdk"
import type { Agent } from "../types"
import { relativeTime } from "../utils"

interface AgentPickerProps {
  apiKey: string
  baseUrl: string
  onSelectAgent: (agentName: string) => void
}

type LoadingState = "loading" | "error" | "empty" | "loaded"

export default function AgentPicker({
  apiKey,
  baseUrl,
  onSelectAgent,
}: AgentPickerProps) {
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
      setErrorMessage(err instanceof Error ? err.message : "Failed to load agents")
      setState("error")
    }
  }, [apiKey, baseUrl])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  return (
    <div className="flex h-full flex-col font-mono text-[13px] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="flex h-13 items-center px-4 md:px-6">
          <span className="font-semibold tracking-tight">superserve</span>
          <span className="ml-1.5 text-neutral-300">/</span>
          <span className="ml-1.5 text-neutral-500">playground</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-10 md:px-6">
          <h1 className="text-lg font-semibold">Select an agent</h1>
          <p className="mt-1 text-neutral-500">
            Choose a deployed agent to start chatting.
          </p>

          <div className="mt-8">
            {state === "loading" && (
              <div className="flex items-center gap-2 py-12 text-neutral-400">
                <svg
                  className="animate-spin"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="28"
                    strokeDashoffset="8"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Loading agents...</span>
              </div>
            )}

            {state === "error" && (
              <div className="rounded-lg border border-neutral-200 px-5 py-8 text-center">
                <p className="font-semibold text-red-600">
                  Failed to load agents
                </p>
                <p className="mt-1.5 text-neutral-500">{errorMessage}</p>
                <button
                  onClick={fetchAgents}
                  className="mt-4 cursor-pointer rounded-md bg-neutral-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-80"
                >
                  Retry
                </button>
              </div>
            )}

            {state === "empty" && (
              <div className="rounded-lg border border-neutral-200 px-5 py-8 text-center">
                <p className="font-semibold">No agents deployed</p>
                <p className="mt-1.5 text-neutral-500">
                  Deploy an agent with{" "}
                  <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                    superserve deploy
                  </code>{" "}
                  to get started.
                </p>
              </div>
            )}

            {state === "loaded" && (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.name)}
                    className="group flex w-full cursor-pointer items-center justify-between rounded-lg border border-neutral-200 px-4 py-3.5 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{agent.name}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {relativeTime(agent.updatedAt)}
                      </p>
                    </div>
                    <svg
                      className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500"
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
