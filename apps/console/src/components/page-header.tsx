interface PageHeaderProps {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex min-h-14 shrink-0 flex-col justify-center gap-1 border-b border-border bg-background/70 px-4 py-2 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p
            className="truncate text-sm text-muted"
            title={typeof description === "string" ? description : undefined}
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
