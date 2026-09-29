import type { NextRequest } from "next/server"

export function GET(request: NextRequest) {
  const caseId = request.nextUrl.searchParams.get("ui_case")
  if (
    caseId === "ss640-google-recovery" ||
    caseId === "ss640-google-repair-recovery"
  ) {
    return new Response(
      "<main><h1>Complete signup</h1><button>Complete signup with Google</button></main>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    )
  }
  if (
    caseId === "ss640-google-auth-error" ||
    caseId === "ss640-google-directory-error"
  ) {
    return new Response(
      '<main><h1>Authentication Error</h1><a href="/auth/signin">Try Again</a></main>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    )
  }
  return new Response("<main>No Sandboxes</main>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}
