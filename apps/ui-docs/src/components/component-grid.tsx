import { Card, CardDescription, CardHeader, CardTitle } from "@superserve/ui"
import { Link } from "react-router"

import type { ComponentMeta } from "../registry/types"

export function ComponentGrid({
  title,
  components,
}: {
  title: string
  components: ComponentMeta[]
}) {
  return (
    <div>
      <h2 className="mb-3 font-mono text-xs tracking-wider text-muted uppercase">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((comp) => (
          <Link
            key={comp.slug}
            to={`/components/${comp.slug}`}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="hover:border-primary-light h-full cursor-pointer transition-colors">
              <CardHeader className="pb-5">
                <CardTitle className="text-sm">{comp.name}</CardTitle>
                <CardDescription className="text-xs">
                  {comp.description}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
