interface EmptyStateProps {
  hasSession: boolean
}

export default function EmptyState({ hasSession }: EmptyStateProps) {
  if (!hasSession) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-neutral-100">
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="#a3a3a3"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h14a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
            <path d="M2 8l9 5.5L20 8" />
          </svg>
        </div>
        <p className="font-medium text-neutral-900">
          No conversation selected
        </p>
        <p className="mt-1 text-[13px] text-neutral-400">
          Create a new chat to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-neutral-100">
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="#737373"
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
      <p className="font-medium text-neutral-900">Start a conversation</p>
      <p className="mt-1 text-[13px] text-neutral-400">
        Type a message below to chat with this agent.
      </p>
    </div>
  )
}
