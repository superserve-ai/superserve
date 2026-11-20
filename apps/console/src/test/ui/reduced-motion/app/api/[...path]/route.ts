import { NextResponse } from "next/server"

import { SANDBOXES } from "../../../fixtures"

export const dynamic = "force-dynamic"

const hang = (signal: AbortSignal) =>
  new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new Error("aborted"))),
  )

// Fake control-plane API. `fx=all` never answers, `fx=sections` answers the
// sandbox itself but never its snapshots / files / network sub-resources.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  const cookie = request.headers.get("cookie") ?? ""
  const mode = /(?:^|; )fx=(loaded|sections|all)/.exec(cookie)?.[1] ?? "loaded"
  if (mode === "all") await hang(request.signal)
  if (mode === "sections" && path.length > 2) await hang(request.signal)

  if (path[0] !== "sandboxes") return NextResponse.json([])
  if (path.length === 1) {
    return NextResponse.json(SANDBOXES, {
      headers: { "X-Total-Count": String(SANDBOXES.length) },
    })
  }
  const sandbox = SANDBOXES.find((s) => s.id === path[1])
  if (!sandbox)
    return NextResponse.json({ error: "not found" }, { status: 404 })
  if (path.length === 2) return NextResponse.json(sandbox)
  if (path[2] === "network")
    return NextResponse.json({ events: [], has_more: false })
  if (path[2] === "files") return NextResponse.json({ entries: [] })
  if (path[2] === "preview-ports")
    return NextResponse.json({ preview_access: "private", ports: [] })
  return NextResponse.json([])
}

// Deleting never answers, so a confirm button stays in its pending state.
export async function DELETE(request: Request) {
  await hang(request.signal)
}
