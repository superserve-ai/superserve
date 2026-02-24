interface EmptyStateProps {
  hasSession: boolean
}

export default function EmptyState({ hasSession }: EmptyStateProps) {
  if (!hasSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-semibold text-neutral-900">
            No conversation selected
          </p>
          <p className="mt-1.5 text-neutral-400">
            Create a new chat to get started.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm font-semibold text-neutral-900">
          No messages yet
        </p>
        <p className="mt-1.5 text-neutral-400">
          Type a message below to start a conversation.
        </p>
      </div>
    </div>
  )
}
