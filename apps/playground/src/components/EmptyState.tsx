interface EmptyStateProps {
  hasSession: boolean
  agentName?: string
  onSend?: (message: string) => void
}

const STARTER_PROMPTS = [
  "What can you do?",
  "Help me get started",
  "Show me an example",
]

export default function EmptyState({ hasSession, agentName, onSend }: EmptyStateProps) {
  if (!hasSession) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover text-muted">
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h14a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
            <path d="M2 8l9 5.5L20 8" />
          </svg>
        </div>
        <p className="font-medium text-foreground">
          No conversation selected
        </p>
        <p className="mt-1 text-[13px] text-muted">
          Create a new chat to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-hover text-ink-muted">
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 5h16a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 3-4-3H3a2 2 0 01-2-2V7a2 2 0 012-2z" />
          <line x1="7" y1="10" x2="7" y2="10.01" />
          <line x1="11" y1="10" x2="11" y2="10.01" />
          <line x1="15" y1="10" x2="15" y2="10.01" />
        </svg>
      </div>
      <p className="font-medium text-foreground">
        {agentName ? `Chat with ${agentName}` : "Start a conversation"}
      </p>
      <p className="mt-1 text-[13px] text-muted">
        Type a message below or try a suggestion.
      </p>
      {onSend && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSend(prompt)}
              className="cursor-pointer border border-dashed border-border px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-border-focus hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
