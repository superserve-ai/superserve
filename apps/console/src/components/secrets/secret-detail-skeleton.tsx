export function SecretDetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-16 bg-muted/20 motion-safe:animate-pulse" />
          <span className="text-muted">/</span>
          <div className="h-4 w-32 bg-muted/20 motion-safe:animate-pulse" />
          <div className="h-5 w-16 bg-muted/20 motion-safe:animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-28 bg-muted/20 motion-safe:animate-pulse" />
          <div className="h-8 w-20 bg-muted/20 motion-safe:animate-pulse" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Info grid */}
        <div className="grid grid-cols-4 border-b border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`px-4 py-4 ${i < 3 ? "border-r border-border" : ""}`}
            >
              <div className="mb-2 h-3 w-16 bg-muted/20 motion-safe:animate-pulse" />
              <div className="h-4 w-28 bg-muted/20 motion-safe:animate-pulse" />
            </div>
          ))}
        </div>

        {/* Hosts section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-3.5 w-24 bg-muted/20 motion-safe:animate-pulse" />
        </div>
        <div className="border-b border-border p-4">
          <div className="h-6 w-64 bg-muted/20 motion-safe:animate-pulse" />
        </div>

        {/* Auth shape section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-3.5 w-24 bg-muted/20 motion-safe:animate-pulse" />
        </div>
        <div className="border-b border-border p-4">
          <div className="h-16 border border-dashed border-border motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  )
}
