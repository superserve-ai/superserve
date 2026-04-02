import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Plan & Usage",
}

export default function PlanUsagePage() {
  return (
    <div>
      <h1 className="text-[28px] font-medium leading-none tracking-tight text-foreground">
        Plan & Usage
      </h1>
      <p className="mt-3 text-sm leading-none tracking-tight text-muted">
        Coming soon.
      </p>
    </div>
  )
}
