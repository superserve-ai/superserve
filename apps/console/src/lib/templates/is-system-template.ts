import type { TemplateResponse } from "../api/types"

export const SYSTEM_TEMPLATE_PREFIX = "superserve/"

/**
 * System (curated) templates are identified by the `superserve/` alias prefix.
 * They're shared across all teams and can't be rebuilt or deleted from
 * the console.
 */
export function isSystemTemplate(
  template: Pick<TemplateResponse, "alias">,
): boolean {
  return template.alias.startsWith(SYSTEM_TEMPLATE_PREFIX)
}
