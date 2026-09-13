/**
 * Tenant slugs become the first DNS label of `<slug>.qm.superserve.ai`, so
 * they follow hostname rules: lowercase alphanumerics and hyphens, no
 * leading/trailing hyphen. Length is capped well under the 63-byte label
 * limit to keep URLs readable.
 */
export const SLUG_MIN_LENGTH = 3
export const SLUG_MAX_LENGTH = 40

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Base host under which tenants are served; overridable for staging. */
export const QM_TENANT_HOST =
  process.env.NEXT_PUBLIC_QM_TENANT_HOST ?? "qm.superserve.ai"

export function tenantUrl(slug: string): string {
  return `https://${slug}.${QM_TENANT_HOST}`
}

/** Derive a slug candidate from an organization name ("Acme, Inc." → "acme-inc"). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "")
}

/** Keep only characters a slug can contain while the user types. */
export function sanitizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, SLUG_MAX_LENGTH)
}

/** Validation message for a slug, or null when it is well-formed. */
export function slugError(slug: string): string | null {
  if (slug.length === 0) return "Choose a subdomain for your stack."
  if (slug.length < SLUG_MIN_LENGTH)
    return `Use at least ${SLUG_MIN_LENGTH} characters.`
  if (slug.length > SLUG_MAX_LENGTH)
    return `Use at most ${SLUG_MAX_LENGTH} characters.`
  if (!SLUG_PATTERN.test(slug))
    return "Lowercase letters, numbers, and hyphens only; no leading or trailing hyphen."
  return null
}
