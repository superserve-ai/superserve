// The device page always redirects with the canonical code, so anything else
// is not a device return.
export function deviceReturnPath(raw: string | null | undefined) {
  return raw &&
    /^\/device\?code=[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(
      raw,
    )
    ? raw
    : null
}
