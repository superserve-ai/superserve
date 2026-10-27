import { NextResponse } from "next/server"

import { DeviceLoginError, pollDeviceCode } from "@/lib/auth/device-login"
import { SignupReviewPendingError } from "@/lib/auth/signup-review"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (typeof body?.device_code !== "string" || !body.device_code)
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing device_code." },
      { status: 400 },
    )
  // Issued codes are 32 random bytes in base64url; anything else can't match,
  // so it never reaches the database.
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.device_code))
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Unknown device code." },
      { status: 400 },
    )
  try {
    const { apiKey, email, newAccount } = await pollDeviceCode(body.device_code)
    return NextResponse.json({
      api_key: apiKey,
      email,
      new_account: newAccount,
    })
  } catch (error) {
    if (error instanceof SignupReviewPendingError)
      return NextResponse.json(
        { error: "access_denied", error_description: error.message },
        { status: 400 },
      )
    if (error instanceof DeviceLoginError && error.code !== "unavailable")
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: 400 },
      )
    console.error("Device login poll failed:", error)
    return NextResponse.json(
      { error: "unavailable", error_description: "Login is unavailable." },
      { status: 503 },
    )
  }
}
