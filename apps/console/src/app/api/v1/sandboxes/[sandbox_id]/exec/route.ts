import { NextResponse } from "next/server"
import { sandboxes } from "../../../_mock/store"

export async function POST(
  request: Request,
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

  if (sandbox.status !== "active" && sandbox.status !== "idle") {
    return NextResponse.json(
      {
        error: {
          code: "conflict",
          message: "Sandbox is not in a runnable state",
        },
      },
      { status: 409 },
    )
  }

  const body = await request.json()
  const { command } = body

  await new Promise((resolve) => setTimeout(resolve, 500))

  return NextResponse.json({
    stdout: `$ ${command}\nHello from sandbox ${sandbox.name}!\n`,
    stderr: "",
    exit_code: 0,
  })
}
