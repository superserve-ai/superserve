import { NextResponse } from "next/server"
import { sandboxes } from "../../_mock/store"

export async function GET(
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

  return NextResponse.json(sandbox)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {

  const { sandbox_id } = await params
  const index = sandboxes.findIndex(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (index === -1) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  sandboxes[index].status = "deleted"
  return new NextResponse(null, { status: 204 })
}
