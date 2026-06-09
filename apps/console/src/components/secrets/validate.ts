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
