import type { CreateSecretRequest, SecretAuthConfig } from "@/lib/api/types"

import { patternsOverlap, validateHeaderName, validateHost } from "./validate"

export type SingleAuthType = "bearer" | "basic" | "api-key" | "custom"

export interface HeaderEntry {
  name: string
  value: string
}

export interface AuthRuleForm {
  /** Allowlist in single mode; the rule's dispatch hosts in per-host mode. */
  hosts: string[]
  type: SingleAuthType
  header: string
  prefix: string
  username: string
  headers: HeaderEntry[]
}

export interface CustomAuthForm {
  perHost: boolean
  single: AuthRuleForm
  rules: AuthRuleForm[]
}

export const MAX_HOSTS = 16
export const MAX_RULES = 16
export const MAX_CUSTOM_HEADERS = 8

export const emptyRule = (): AuthRuleForm => ({
  hosts: [""],
  type: "bearer",
  header: "",
  prefix: "",
  username: "",
  headers: [{ name: "", value: "" }],
})

export const emptyCustomAuthForm = (): CustomAuthForm => ({
  perHost: false,
  single: emptyRule(),
  rules: [emptyRule()],
})

function cleanHosts(hosts: string[]): string[] {
  return hosts.map((h) => h.trim()).filter(Boolean)
}

function filledHeaders(rule: AuthRuleForm): HeaderEntry[] {
  return rule.headers.filter((h) => h.name.trim() || h.value)
}

/** Whether every required field has content. Gates the submit button
 *  without surfacing "is required" noise while the user is still typing. */
export function customFormComplete(form: CustomAuthForm): boolean {
  const ruleComplete = (rule: AuthRuleForm): boolean => {
    if (cleanHosts(rule.hosts).length === 0) return false
    if (rule.type === "api-key" && !rule.header.trim()) return false
    if (rule.type === "custom" && filledHeaders(rule).length === 0) return false
    return true
  }
  if (!form.perHost) return ruleComplete(form.single)
  return form.rules.length > 0 && form.rules.every(ruleComplete)
}

function validateRuleHosts(rule: AuthRuleForm, label: string): string | null {
  const hosts = cleanHosts(rule.hosts)
  if (hosts.length > MAX_HOSTS) return `${label}: max ${MAX_HOSTS} hosts`
  for (const h of hosts) {
    const err = validateHost(h)
    if (err) return `${label}: "${h}" — ${err.toLowerCase()}`
  }
  return null
}

function validateRuleShape(rule: AuthRuleForm, label: string): string | null {
  switch (rule.type) {
    case "bearer":
      return null
    case "basic":
      if (/[:\r\n]/.test(rule.username))
        return `${label}: username may not contain ':'`
      return null
    case "api-key": {
      const header = rule.header.trim()
      if (header && validateHeaderName(header))
        return `${label}: "${header}" is not a valid header name`
      return null
    }
    case "custom": {
      const entries = filledHeaders(rule)
      if (entries.length > MAX_CUSTOM_HEADERS)
        return `${label}: max ${MAX_CUSTOM_HEADERS} headers`
      for (const h of entries) {
        const name = h.name.trim()
        if (!name) continue
        if (validateHeaderName(name))
          return `${label}: "${name}" is not a valid header name`
        if (!h.value.includes("{{ value }}"))
          return `${label}: header "${name}" must reference {{ value }} so the credential is injected`
      }
      return null
    }
  }
}

/** Mistakes only — empty fields are handled by customFormComplete, so this
 *  can be shown live without nagging about untouched inputs. */
export function validateCustomAuthForm(form: CustomAuthForm): string | null {
  if (!form.perHost) {
    return (
      validateRuleHosts(form.single, "Hosts") ??
      validateRuleShape(form.single, "Auth")
    )
  }
  if (form.rules.length > MAX_RULES) return `Max ${MAX_RULES} rules`
  const seen: { host: string; rule: number }[] = []
  for (let i = 0; i < form.rules.length; i++) {
    const rule = form.rules[i]
    const label = `Rule ${i + 1}`
    const hostErr = validateRuleHosts(rule, label)
    if (hostErr) return hostErr
    for (const h of cleanHosts(rule.hosts)) {
      for (const prev of seen) {
        if (patternsOverlap(h, prev.host))
          return `${label}: "${h}" overlaps with rule ${prev.rule}'s "${prev.host}"`
      }
      seen.push({ host: h, rule: i + 1 })
    }
    const shapeErr = validateRuleShape(rule, label)
    if (shapeErr) return shapeErr
  }
  if (seen.length > MAX_HOSTS)
    return `Rules reference ${seen.length} hosts in total; max ${MAX_HOSTS}`
  return null
}

function shapeFields(rule: AuthRuleForm): Record<string, unknown> {
  switch (rule.type) {
    case "bearer":
      return {}
    case "basic":
      return rule.username.trim() ? { username: rule.username.trim() } : {}
    case "api-key":
      // prefix is NOT trimmed — a trailing space ("Bearer ") is significant.
      return {
        header: rule.header.trim(),
        ...(rule.prefix ? { prefix: rule.prefix } : {}),
      }
    case "custom":
      return {
        headers: Object.fromEntries(
          filledHeaders(rule)
            .filter((h) => h.name.trim())
            .map((h) => [h.name.trim(), h.value]),
        ),
      }
  }
}

export function buildCustomSecretPayload(
  name: string,
  value: string,
  form: CustomAuthForm,
): CreateSecretRequest {
  if (!form.perHost) {
    return {
      name: name.trim(),
      value,
      hosts: cleanHosts(form.single.hosts),
      auth: {
        type: form.single.type,
        ...shapeFields(form.single),
      } as SecretAuthConfig,
    }
  }
  const rules = form.rules.map((r) => ({
    hosts: cleanHosts(r.hosts),
    type: r.type,
    ...shapeFields(r),
  }))
  // The allowlist is the union of all rule hosts — a host outside every
  // rule would never get auth injected, so a broader list buys nothing.
  const hosts = [...new Set(rules.flatMap((r) => r.hosts))]
  return {
    name: name.trim(),
    value,
    hosts,
    auth: { per_host: rules } as SecretAuthConfig,
  }
}
