import { NextResponse } from "next/server"
import { snapshots } from "../_mock/store"

export async function GET(_request: Request) {

  return NextResponse.json(snapshots)
}
