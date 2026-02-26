import { useState, useEffect, useCallback } from "react"
import { Superserve } from "@superserve/sdk"
import { Button, Card, Skeleton } from "@superserve/ui"
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
    <div className="flex h-full flex-col bg-background text-sm text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="flex h-14 items-center px-5 md:px-8">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="text-muted">Superserve</span>
            <span className="text-ink-faint">/</span>
            <span className="font-medium text-foreground">Playground</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 py-12 md:px-8">
          <h1 className="text-xl font-semibold tracking-tight">Your Agents</h1>
          <p className="mt-1.5 text-[13px] text-muted">
            Select an agent to open the chat playground.
          </p>

          <div className="mt-8">
            {state === "loading" && (
              <Card className="divide-y divide-border">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="px-5 py-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-3 w-24" />
                  </div>
                ))}
              </Card>
            )}

            {state === "error" && (
              <Card className="px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <circle cx="9" cy="9" r="7" />
                    <line x1="9" y1="6" x2="9" y2="9.5" />
                    <circle cx="9" cy="12" r="0.5" fill="currentColor" />
                  </svg>
                </div>
                <p className="font-medium text-foreground">
                  Failed to load agents
                </p>
                <p className="mt-1 text-[13px] text-muted">{errorMessage}</p>
                <Button onClick={fetchAgents} className="mt-4">
                  Try again
                </Button>
              </Card>
            )}

            {state === "empty" && (
              <Card className="px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-surface-hover text-muted">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="4" width="14" height="10" />
                    <path d="M6 4V2.5a1.5 1.5 0 013 0V4" />
                    <line x1="9" y1="8" x2="9" y2="11" />
                  </svg>
                </div>
                <p className="font-medium text-foreground">
                  No agents deployed
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  Deploy an agent with{" "}
                  <code className="bg-surface-hover px-1.5 py-0.5 font-mono text-xs">
                    superserve deploy
                  </code>{" "}
                  to get started.
                </p>
              </Card>
            )}

            {state === "loaded" && (
              <Card className="divide-y divide-border">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    className="group flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {agent.name}
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        Updated {relativeTime(agent.updatedAt)}
                      </p>
                    </div>
                    <svg
                      className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
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
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
