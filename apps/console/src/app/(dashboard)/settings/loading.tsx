import { PageHeader } from "@/components/page-header"

export default function SettingsLoading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />

      <div className="flex-1 overflow-y-auto">
        {/* Profile section skeleton */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <div className="h-5 w-16 bg-surface-hover motion-safe:animate-pulse" />
            <div className="mt-2 h-3 w-40 bg-surface-hover motion-safe:animate-pulse" />
          </div>
          <div className="max-w-md space-y-5">
            <div className="space-y-2">
              <div className="h-3 w-20 bg-surface-hover motion-safe:animate-pulse" />
              <div className="h-9 w-full bg-surface-hover motion-safe:animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-12 bg-surface-hover motion-safe:animate-pulse" />
              <div className="h-9 w-full bg-surface-hover motion-safe:animate-pulse" />
            </div>
            <div className="h-8 w-28 bg-surface-hover motion-safe:animate-pulse" />
          </div>
        </div>

        <div className="border-b border-border" />

        {/* Password section skeleton */}
        <div className="grid grid-cols-[240px_1fr] gap-12 px-8 py-8">
          <div>
            <div className="h-5 w-20 bg-surface-hover motion-safe:animate-pulse" />
            <div className="mt-2 h-3 w-48 bg-surface-hover motion-safe:animate-pulse" />
          </div>
          <div className="max-w-md space-y-5">
            <div className="space-y-2">
              <div className="h-3 w-28 bg-surface-hover motion-safe:animate-pulse" />
              <div className="h-9 w-full bg-surface-hover motion-safe:animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-24 bg-surface-hover motion-safe:animate-pulse" />
              <div className="h-9 w-full bg-surface-hover motion-safe:animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-36 bg-surface-hover motion-safe:animate-pulse" />
              <div className="h-9 w-full bg-surface-hover motion-safe:animate-pulse" />
            </div>
            <div className="h-8 w-32 bg-surface-hover motion-safe:animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}
