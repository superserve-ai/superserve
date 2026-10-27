import { NextResponse } from "next/server"

import {
  createDeviceCode,
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DeviceLoginError,
  sanitizeClientName,
} from "@/lib/auth/device-login"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const requester =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  try {
    const { deviceCode, userCode } = await createDeviceCode({
      clientName: sanitizeClientName(body?.client_name),
      requester,
    })
    const verificationUri = new URL("/device", request.url)
    const complete = new URL(verificationUri)
    complete.searchParams.set("code", userCode)
    return NextResponse.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri.toString(),
      verification_uri_complete: complete.toString(),
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    })
  } catch (error) {
    if (error instanceof DeviceLoginError && error.code === "rate_limited")
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: 429 },
      )
    console.error("Device login start failed:", error)
    return NextResponse.json(
      { error: "unavailable", error_description: "Login is unavailable." },
      { status: 503 },
    )
  }
}
