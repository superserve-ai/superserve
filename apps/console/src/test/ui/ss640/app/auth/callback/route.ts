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
  // The production callback may use its deployed APP_URL outside preview
  // mode. This fixture must keep every declared redirect on the runner-owned
  // loopback origin, without changing the callback's selected path/query.
  const location = response.headers.get("location")
  if (location) {
    const redirect = new URL(location, url)
    if (redirect.origin !== url.origin) {
      response.headers.set(
        "location",
        `${redirect.pathname}${redirect.search}${redirect.hash}`,
      )
    }
  }
  response.cookies.set("ss640-ui-case", caseId, { path: "/", sameSite: "lax" })
  return response
}
