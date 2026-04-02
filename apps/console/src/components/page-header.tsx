interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between h-14 border-b border-border px-6">
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </div>
  )
}
