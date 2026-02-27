import { ChevronRight } from "lucide-react"
import { cn } from "../lib/utils"

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
  renderLink?: (props: {
    href: string
    children: React.ReactNode
  }) => React.ReactNode
}

const defaultRenderLink = ({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) => (
  <a href={href} className="text-muted hover:text-foreground transition-colors">
    {children}
  </a>
)

function Breadcrumbs({
  items,
  className,
  renderLink = defaultRenderLink,
  ...props
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1.5 text-sm", className)}
      {...props}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <div key={item.label} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
            {isLast || !item.href ? (
              <span
                className={cn(
                  isLast ? "text-foreground font-medium" : "text-muted",
                )}
              >
                {item.label}
              </span>
            ) : (
              renderLink({ href: item.href, children: item.label })
            )}
          </div>
        )
      })}
    </nav>
  )
}

export { Breadcrumbs }
export type { BreadcrumbItem, BreadcrumbsProps }
