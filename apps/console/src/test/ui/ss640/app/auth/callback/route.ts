import { GET as productionCallback } from "../../../../../../app/(auth)/auth/callback/route"
import { withSyntheticCase } from "../../../server-dependencies"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const cookieCase = request.headers
    .get("cookie")
    ?.split("; ")
    .find((entry) => entry.startsWith("ss640-ui-case="))
    ?.slice("ss640-ui-case=".length)
  const caseId =
    url.searchParams.get("ui_case") ??
    (cookieCase ? decodeURIComponent(cookieCase) : "ss640-google-first-team")
  // Supply provider transport inputs at the fixture boundary. The actual
  // callback selects the redirects, checks provenance and binds the account.
  if (caseId === "ss640-email-confirmed-entry") {
    url.searchParams.set("token_hash", "synthetic-token")
    url.searchParams.set("type", "signup")
    url.searchParams.set("device_attempt_id", "synthetic-attempt")
    url.searchParams.set("device_bind_proof", "synthetic-proof")
  } else {
    url.searchParams.set("code", "synthetic-code")
    url.searchParams.set("signup_attempt_id", "synthetic-oauth-attempt")
  }
  const response = await withSyntheticCase(caseId, () =>
    productionCallback(new Request(url)),
  )
  response.cookies.set("ss640-ui-case", caseId, { path: "/", sameSite: "lax" })
  return response
}
