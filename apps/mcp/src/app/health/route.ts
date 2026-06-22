/** Liveness probe for load balancers / uptime checks. No auth. */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "content-type": "application/json" },
  })
}
