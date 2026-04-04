import { NextResponse } from "next/server"
import { apiKeys } from "../_mock/store"

export async function GET(_request: Request) {

  const keys = apiKeys.map(({ full_key: _, ...rest }) => rest)
  return NextResponse.json(keys)
}

export async function POST(request: Request) {

  const body = await request.json()
  const { name } = body

  if (!name) {
    return NextResponse.json(
      {
        error: { code: "bad_request", message: "Missing required field: name" },
      },
      { status: 400 },
    )
  }

  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let keyStr = ""
  for (let i = 0; i < 32; i++) {
    keyStr += chars[Math.floor(Math.random() * chars.length)]
  }

  const fullKey = `ss_live_${keyStr}`
  const prefix = `ss_live_${keyStr.slice(0, 8)}...`
  const id = crypto.randomUUID()

  const newKey = {
    id,
    name,
    prefix,
    full_key: fullKey,
    created_at: new Date().toISOString(),
    last_used_at: null,
  }

  apiKeys.push(newKey)

  return NextResponse.json(
    { id, name, key: fullKey, prefix, created_at: newKey.created_at },
    { status: 201 },
  )
}
