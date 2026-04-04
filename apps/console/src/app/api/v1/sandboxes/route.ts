import { NextResponse } from "next/server"
import { sandboxes } from "../_mock/store"

export async function GET(_request: Request) {
  return NextResponse.json(sandboxes.filter((s) => s.status !== "deleted"))
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, vcpu_count, memory_mib } = body

  if (!name || !vcpu_count || !memory_mib) {
    return NextResponse.json(
      {
        error: {
          code: "bad_request",
          message: "Missing required fields: name, vcpu_count, memory_mib",
        },
      },
      { status: 400 },
    )
  }

  const id = crypto.randomUUID()
  const sandbox = {
    id,
    name,
    status: "starting" as const,
    vcpu_count,
    memory_mib,
    created_at: new Date().toISOString(),
  }

  sandboxes.push(sandbox)

  setTimeout(() => {
    const entry = sandboxes.find((s) => s.id === id)
    if (entry && entry.status === "starting") {
      entry.status = "active"
      entry.ip_address = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
    }
  }, 3000)

  return NextResponse.json(sandbox, { status: 201 })
}
