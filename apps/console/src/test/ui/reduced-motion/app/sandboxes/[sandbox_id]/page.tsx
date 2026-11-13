import SandboxDetailPage from "@/app/(dashboard)/sandboxes/[sandbox_id]/page"

import { FixtureShell } from "../../fixture-shell"

export default function Page() {
  return (
    <FixtureShell>
      <SandboxDetailPage />
    </FixtureShell>
  )
}
