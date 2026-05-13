import { ComponentGrid } from "../components/component-grid"
import { categories, getByCategory } from "../registry"

export function Home() {
  return (
    <div className="max-w-4xl p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">
          Superserve UI
        </h1>
        <p className="mt-1 text-muted">
          Component library built with React, Radix UI, and Tailwind CSS.
        </p>
      </div>
      <div className="space-y-8">
        {categories.map((cat) => (
          <ComponentGrid
            key={cat}
            title={cat}
            components={getByCategory(cat)}
          />
        ))}
      </div>
    </div>
  )
}
