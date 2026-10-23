"use client"

import { Badge, Button } from "@superserve/ui"
import { useState, type ReactNode } from "react"

import { setPricingVersionAction } from "@/lib/admin/billing-catalog-actions"
import type { PricingVersion } from "@/lib/billing/plans"

import type { Confirmation } from "./plans-catalog"

export const PRICING_LABEL = {
  legacy: "Legacy pricing",
  v2: "Pricing v2",
} as const

const ALL = "all"

// Everything staff need to activate pricing v2 in a region, on one screen:
// the region's switch state, the activation steps for that region, and the
// switch itself. Activation steps render through `steps` for a single region.
export function PricingActivation({
  live,
  canWrite,
  locked,
  confirm,
  steps,
}: {
  live: Record<string, PricingVersion>
  canWrite: boolean
  locked: boolean
  confirm: (confirmation: Confirmation) => void
  steps?: (region: string) => ReactNode
}) {
  const regions = Object.keys(live)
  const [selected, setSelected] = useState(
    regions.length === 1 ? regions[0]! : ALL,
  )
  const targets = selected === ALL ? regions : [selected]
  const values = new Set(targets.map((region) => live[region]!))
  const current = values.size === 1 ? [...values][0]! : null
  const options: PricingVersion[] = current
    ? [current === "v2" ? "legacy" : "v2"]
    : ["legacy", "v2"]
  const where = selected === ALL ? "every region" : selected
  return (
    <section
      aria-label="Pricing model"
      className="space-y-4 border border-dashed border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="font-mono text-xs text-muted uppercase">
            Pricing model
          </p>
          <p className="text-2xl font-medium">
            {current ? PRICING_LABEL[current] : "Regions differ"}
          </p>
          <span className="flex flex-wrap gap-1">
            {regions.map((region) => (
              <Badge
                key={region}
                variant={live[region] === "v2" ? "success" : "muted"}
              >
                {region}: {live[region]}
              </Badge>
            ))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {regions.length > 1 ? (
            <select
              aria-label="Region"
              className="border border-dashed border-border bg-transparent p-2 text-sm"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value={ALL}>All regions</option>
              {regions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          ) : null}
          {canWrite
            ? options.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === "v2" ? "default" : "outline"}
                  disabled={locked}
                  onClick={() =>
                    confirm({
                      title: `Switch ${where} to ${PRICING_LABEL[to].toLowerCase()}?`,
                      description:
                        to === "v2"
                          ? "Signup, checkout and the pricing cards use the published v2 plans immediately. Existing contracts keep their terms."
                          : "Signup, checkout and the pricing cards go back to the published legacy plans immediately. Existing contracts keep their terms.",
                      action: (reason) =>
                        setPricingVersionAction(to, reason, targets),
                      done: `${PRICING_LABEL[to]} is live in ${where}`,
                    })
                  }
                >
                  Switch {where} to {to}
                </Button>
              ))
            : null}
        </div>
      </div>
      {steps && selected !== ALL ? steps(selected) : null}
    </section>
  )
}
