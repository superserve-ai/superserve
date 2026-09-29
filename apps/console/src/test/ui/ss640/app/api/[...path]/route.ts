export function GET(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "")
  if (path === "/api/fixture-logo" || path === "/logo.svg") {
    return new Response(process.env.SS640_FIXTURE_LOGO_SVG, {
      headers: { "Content-Type": "image/svg+xml" },
    })
  }
  return Response.json({
    user: { id: "ui-fixture-user", email: "fixture@example.test" },
    evidence: { status: "verified" },
    region: "use",
    team: null,
    credit: { granted: false, reason: "fixture-only" },
  })
}

export function POST() {
  return Response.json({ ok: true, decision: "fixture-only", created: true })
}
