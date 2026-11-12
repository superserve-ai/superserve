import { isSelfServeSignupOffer, signInOfferDestination } from "./signup-offer"

// Where a sign-up tab goes once its email is confirmed in another tab. It
// matches where the sign-in page sends a signed-in visitor, and it follows
// only a plain local path: a browser reads "/\host" as another site, so a
// backslash or control character falls back to "/".
export function confirmedSignupDestination(
  nextUrl: string,
  rawOffer: string | undefined,
): string {
  const localNext =
    nextUrl.startsWith("/") &&
    !nextUrl.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/.test(nextUrl)
      ? nextUrl
      : "/"
  return localNext === "/" && isSelfServeSignupOffer(rawOffer)
    ? signInOfferDestination(rawOffer)
    : localNext
}
