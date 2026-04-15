interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between h-14 border-b border-border bg-background px-6">
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </div>
  )
}
