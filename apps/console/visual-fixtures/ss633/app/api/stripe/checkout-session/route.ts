import { NextResponse } from "next/server"

const checkoutErrors: Record<string, string> = {
  membership: "Checkout membership unavailable; please retry",
  transport: "Checkout recovery unavailable",
  authentication: "Checkout recovery authentication unavailable",
  publication: "Promotion identity unavailable; please retry",
}

export async function POST(request: Request) {
  const body = await request.json()
  const successUrl = body?.success_url
  const selectedCase =
    typeof successUrl === "string"
      ? new URL(successUrl).searchParams.get("case")
      : null
  const message = selectedCase ? checkoutErrors[selectedCase] : undefined
  if (!message) {
    return NextResponse.json(
      { error: { code: "unknown_fixture_case" } },
      { status: 400 },
    )
  }
  return NextResponse.json(
    { error: { code: "service_unavailable", message } },
    { status: 503 },
  )
}
