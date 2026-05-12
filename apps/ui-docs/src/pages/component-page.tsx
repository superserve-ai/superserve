import { Separator } from "@superserve/ui"
import { useEffect } from "react"
import { Link, useParams } from "react-router"

import { ExamplePreview } from "../components/example-preview"
import { PropsTable } from "../components/props-table"
import { getBySlug } from "../registry"

export function ComponentPage() {
  const { slug } = useParams()
  const meta = slug ? getBySlug(slug) : undefined

  useEffect(() => {
    document.title = meta ? `${meta.name} - Superserve UI` : "Superserve UI"
    return () => {
      document.title = "Superserve UI"
    }
  }, [meta])

  if (!meta) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-foreground">Not Found</h1>
        <p className="mt-2 text-muted">
          Component "{slug}" does not exist.{" "}
          <Link to="/" className="text-primary underline underline-offset-2">
            Go home
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">{meta.name}</h1>
        <p className="mt-1 text-muted">{meta.description}</p>
        <p className="mt-2 font-mono text-xs text-muted">
          Source: <code className="text-primary">{meta.source}</code>
        </p>
      </div>

      <div className="space-y-8">
        {meta.examples.map((example) => (
          <ExamplePreview key={example.title} example={example} />
        ))}
      </div>

      {meta.props.length > 0 && (
        <>
          <Separator className="my-8" />
          <PropsTable props={meta.props} />
        </>
      )}
    </div>
  )
}
