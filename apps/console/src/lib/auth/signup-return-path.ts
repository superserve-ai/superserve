// The local path a sign-up tab may follow once its email is confirmed in
// another tab. Only a plain local path counts: a browser reads "/\host" as
// another site, so a backslash or control character falls back to "/".
export function confirmedSignupReturnPath(nextUrl: string): string {
  return nextUrl.startsWith("/") &&
    !nextUrl.startsWith("//") &&
    !/[\\\u0000- \u007f]/.test(nextUrl)
    ? nextUrl
    : "/"
}
