import { NextResponse } from "next/server"
import { sandboxes } from "../../../_mock/store"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  if (sandbox.status !== "active") {
    return NextResponse.json(
      {
        error: { code: "conflict", message: "Sandbox must be active to pause" },
      },
      { status: 409 },
    )
  }

  sandbox.status = "idle"
  sandbox.snapshot_id = crypto.randomUUID()
  sandbox.ip_address = undefined

  return NextResponse.json(sandbox)
}
