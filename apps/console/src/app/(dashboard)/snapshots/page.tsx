import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Snapshots",
}

export default function SnapshotsPage() {
  return (
    <div>
      <h1 className="text-[28px] font-medium leading-none tracking-tight text-foreground">
        Snapshots
      </h1>
      <p className="mt-3 text-sm leading-none tracking-tight text-muted">
        Coming soon.
      </p>
    </div>
  )
}
