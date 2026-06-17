import { Badge, Tooltip, TooltipPopup, TooltipTrigger } from "@superserve/ui"
import Link from "next/link"

import type { SandboxSecretBindingSummary } from "@/lib/api/types"

export function SecretBindingList({
  secrets,
}: {
  secrets: SandboxSecretBindingSummary[] | undefined
}) {
  return (
    <div className="border-b border-border">
      <div className="flex h-10 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Secrets</h2>
      </div>
      {!secrets || secrets.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted">
          No secrets attached to this sandbox.
        </p>
      ) : (
        <div className="space-y-2 px-4 py-3">
          {secrets.map((binding) => (
            <div
              key={binding.env_key}
              className="flex items-center gap-3 font-mono text-xs"
            >
              <span className="text-foreground/80">{binding.env_key}</span>
              <span className="text-muted">←</span>
              <Link
                href={`/secrets/${binding.secret_name}`}
                className="text-foreground/80 underline-offset-2 hover:underline"
              >
                {binding.secret_name}
              </Link>
              {binding.revoked && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge variant="destructive" className="cursor-default" />
                    }
                  >
                    Revoked
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-xs text-xs">
                    This secret was deleted - requests using it are rejected.
                  </TooltipPopup>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
