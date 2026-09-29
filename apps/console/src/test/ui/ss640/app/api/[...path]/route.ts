export function GET() {
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
