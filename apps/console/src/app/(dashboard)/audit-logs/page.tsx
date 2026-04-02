import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Audit Logs",
}

export default function AuditLogsPage() {
  return (
    <div>
      <h1 className="text-[28px] font-medium leading-none tracking-tight text-foreground">
        Audit Logs
      </h1>
      <p className="mt-3 text-sm leading-none tracking-tight text-muted">
        Coming soon.
      </p>
    </div>
  )
}
