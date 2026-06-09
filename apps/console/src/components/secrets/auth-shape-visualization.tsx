import type { SecretAuthType, SecretPerHostRule } from "@/lib/api/types"

const MASK = "••••••••"

interface RuleConfig {
  header?: string
  prefix?: string
  username?: string
  headers?: Record<string, string>
}

function shapeLines(
  type: Exclude<SecretAuthType, "per_host">,
  cfg: RuleConfig,
): string[] {
  switch (type) {
    case "bearer":
      return [`Authorization: Bearer ${MASK}`]
    case "basic":
      return [`Authorization: Basic base64(${cfg.username || "x"}:${MASK})`]
    case "api-key":
      return [`${cfg.header || "Authorization"}: ${cfg.prefix ?? ""}${MASK}`]
    case "custom":
      return Object.entries(cfg.headers ?? {}).map(
        ([name, tmpl]) => `${name}: ${tmpl.replaceAll("{{ value }}", MASK)}`,
      )
  }
}

function ShapeBlock({ lines }: { lines: string[] }) {
  return (
    <div className="px-3 py-2">
      {lines.map((line) => (
        <p key={line} className="font-mono text-xs text-foreground/80">
          {line}
        </p>
      ))}
    </div>
  )
}

export function AuthShapeVisualization({
  authType,
  authConfig,
}: {
  authType: SecretAuthType
  authConfig: Record<string, unknown>
}) {
  if (authType === "per_host") {
    const rules = (authConfig.per_host as SecretPerHostRule[] | undefined) ?? []
    return (
      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={i} className="border border-border bg-background">
            <p className="border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted">
              {rule.hosts.join(", ")}
            </p>
            <ShapeBlock lines={shapeLines(rule.type, rule)} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="border border-border bg-background">
      <ShapeBlock lines={shapeLines(authType, authConfig as RuleConfig)} />
    </div>
  )
}
