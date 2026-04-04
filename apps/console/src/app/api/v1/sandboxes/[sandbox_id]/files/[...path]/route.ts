import { NextResponse } from "next/server"
import { sandboxes } from "../../../../_mock/store"

const fileStore = new Map<string, ArrayBuffer>()

function getStoreKey(sandboxId: string, path: string): string {
  return `${sandboxId}:${path}`
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string; path: string[] }> },
) {

  const { sandbox_id, path } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const filePath = path.join("/")
  const buffer = await request.arrayBuffer()
  fileStore.set(getStoreKey(sandbox_id, filePath), buffer)

  return NextResponse.json({ path: filePath, size: buffer.byteLength })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sandbox_id: string; path: string[] }> },
) {

  const { sandbox_id, path } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const filePath = path.join("/")
  const buffer = fileStore.get(getStoreKey(sandbox_id, filePath))

  if (!buffer) {
    return NextResponse.json(
      { error: { code: "not_found", message: "File not found" } },
      { status: 404 },
    )
  }

  return new Response(buffer, {
    headers: { "Content-Type": "application/octet-stream" },
  })
}
