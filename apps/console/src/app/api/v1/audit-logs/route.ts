import { NextResponse } from "next/server"
import { auditLogs } from "../_mock/store"

export async function GET(_request: Request) {

  return NextResponse.json(auditLogs)
}
