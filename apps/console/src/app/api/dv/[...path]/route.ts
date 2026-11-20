import type { NextRequest } from "next/server"

import { forwardHeedeoRequest, heedeoProxyOptions } from "@/lib/heedeo/proxy"

// Heedeo's script and identify endpoint, served from the console origin so ad
// and privacy blockers that list Heedeo's hosts do not stop the sign-up
// observation. Public on purpose (the sign-up page is signed out); the
// middleware skips /api/. See `lib/heedeo/proxy.ts` for the limits.
export const dynamic = "force-dynamic"

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  return forwardHeedeoRequest(
    request,
    path,
    heedeoProxyOptions(request.headers),
  )
}

export { handle as GET, handle as OPTIONS, handle as POST }
