const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function validateSecretName(name: string): string | null {
  if (!name) return "Name is required"
  if (name.length > 128) return "Name must be 128 characters or fewer"
  if (!NAME_RE.test(name))
    return "Use letters, digits, '_' and '-'; start with a letter or underscore"
  return null
}

export function validateSecretValue(value: string): string | null {
  if (!value) return "Value is required"
  if (new TextEncoder().encode(value).length > 8 * 1024)
    return "Value exceeds 8 KB"
  return null
}

const HOST_RE =
  /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/

// Wildcards on a public suffix (*.co.uk) are caught server-side against
// the full PSL; the backend message surfaces in the form error box.
export function validateHost(host: string): string | null {
  if (!HOST_RE.test(host)) return "Not a valid hostname"
  return null
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function validateEnvKey(key: string): string | null {
  if (!ENV_KEY_RE.test(key)) return "Not a valid env var name"
  return null
}

const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/

export function validateHeaderName(name: string): string | null {
  if (!HEADER_NAME_RE.test(name)) return "Not a valid header name"
  return null
}

/** True when a and b can match at least one common host. Both may be exact
 *  hosts or `*.suffix` wildcards. Mirrors the backend's overlap check. */
export function patternsOverlap(a: string, b: string): boolean {
  a = a.trim().toLowerCase()
  b = b.trim().toLowerCase()
  if (a === b) return true
  const aWild = a.startsWith("*.")
  const bWild = b.startsWith("*.")
  if (!aWild && !bWild) return false
  if (aWild && !bWild) {
    return b.endsWith(a.slice(1)) && b !== a.slice(2)
  }
  if (!aWild && bWild) {
    return a.endsWith(b.slice(1)) && a !== b.slice(2)
  }
  const aSuf = a.slice(1)
  const bSuf = b.slice(1)
  return aSuf.endsWith(bSuf) || bSuf.endsWith(aSuf)
}
