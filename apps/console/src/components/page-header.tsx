interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur-md">
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </div>
  )
}
