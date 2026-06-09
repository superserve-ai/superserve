"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { Button, Field } from "@superserve/ui"

import { AuthConfigForm } from "./auth-config-form"
import type { AuthRuleForm } from "./custom-auth"
import { emptyRule, MAX_RULES } from "./custom-auth"
import { HostInput } from "./host-input"

export function PerHostRuleEditor({
  rules,
  onChange,
}: {
  rules: AuthRuleForm[]
  onChange: (rules: AuthRuleForm[]) => void
}) {
  const setRule = (i: number, rule: AuthRuleForm) => {
    const updated = [...rules]
    updated[i] = rule
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      {rules.map((rule, i) => (
        <div
          key={i}
          className="space-y-4 border border-dashed border-border p-4"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted uppercase">
              Rule {i + 1}
            </span>
            {rules.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove rule"
                onClick={() => onChange(rules.filter((_, j) => j !== i))}
              >
                <TrashIcon className="size-3.5 text-muted" weight="light" />
              </Button>
            )}
          </div>
          <Field label="Hosts" required>
            <HostInput
              hosts={rule.hosts}
              onChange={(hosts) => setRule(i, { ...rule, hosts })}
            />
          </Field>
          <AuthConfigForm rule={rule} onChange={(r) => setRule(i, r)} />
        </div>
      ))}
      {rules.length < MAX_RULES && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...rules, emptyRule()])}
        >
          <PlusIcon className="size-3.5" weight="light" />
          Add rule
        </Button>
      )}
      <p className="text-xs text-muted">
        Each request uses the rule matching its host. Hosts may not overlap
        across rules.
      </p>
    </div>
  )
}
