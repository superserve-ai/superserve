export function TemplateDetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-20 animate-pulse bg-muted/20" />
          <span className="text-muted">/</span>
          <div className="h-4 w-32 animate-pulse bg-muted/20" />
          <div className="h-5 w-16 animate-pulse bg-muted/20" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-32 animate-pulse bg-muted/20" />
          <div className="h-8 w-20 animate-pulse bg-muted/20" />
          <div className="h-8 w-20 animate-pulse bg-muted/20" />
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
              <div className="mb-2 h-3 w-16 animate-pulse bg-muted/20" />
              <div className="h-4 w-28 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>

        {/* Current build section */}
        <div className="flex h-10 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            <div className="h-3.5 w-24 animate-pulse bg-muted/20" />
            <div className="h-5 w-20 animate-pulse bg-muted/20" />
          </div>
        </div>
        <div className="border-b border-border p-4">
          <div className="h-40 animate-pulse border border-dashed border-border" />
        </div>

        {/* Build history section */}
        <div className="flex h-10 items-center border-b border-border px-4">
          <div className="h-3.5 w-24 animate-pulse bg-muted/20" />
        </div>
        <div className="border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="size-3.5 animate-pulse bg-muted/20" />
              <div className="h-5 w-16 animate-pulse bg-muted/20" />
              <div className="h-3 w-24 animate-pulse bg-muted/20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
