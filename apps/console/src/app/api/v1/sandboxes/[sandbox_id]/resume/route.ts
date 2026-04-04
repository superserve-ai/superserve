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

  if (sandbox.status !== "idle") {
    return NextResponse.json(
      {
        error: { code: "conflict", message: "Sandbox must be idle to resume" },
      },
      { status: 409 },
    )
  }

  sandbox.status = "active"
  sandbox.ip_address = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

  return NextResponse.json(sandbox)
}
