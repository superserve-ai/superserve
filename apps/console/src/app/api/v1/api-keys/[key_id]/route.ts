import { NextResponse } from "next/server"
import { apiKeys } from "../../_mock/store"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key_id: string }> },
) {
  const { key_id } = await params
  const index = apiKeys.findIndex((k) => k.id === key_id)

  if (index === -1) {
    return NextResponse.json(
      { error: { code: "not_found", message: "API key not found" } },
      { status: 404 },
    )
  }

  apiKeys.splice(index, 1)
  return new NextResponse(null, { status: 204 })
}
