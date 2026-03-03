import { useState } from "react"
import { Link, useParams } from "react-router"
import { Button, Separator } from "@superserve/ui"
import { Menu, X } from "lucide-react"
import { categories, getByCategory } from "../../registry"

export function Sidebar() {
  const { slug } = useParams()
  const [open, setOpen] = useState(false)

  const nav = (
    <>
      <Link to="/" className="block mb-4" onClick={() => setOpen(false)}>
        <p className="text-sm font-semibold text-foreground">Superserve UI</p>
      </Link>
      <Separator className="mb-4" />
      <nav className="space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1.5 px-3">
              {cat}
            </p>
            <div className="space-y-0.5">
              {getByCategory(cat).map((item) => (
                <Link
                  key={item.slug}
                  to={`/components/${item.slug}`}
                  onClick={() => setOpen(false)}
                  className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    slug === item.slug
                      ? "bg-surface-hover text-foreground font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile toggle */}
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
          onKeyDown={() => {}}
          role="presentation"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-40 w-56 bg-background border-r border-dashed border-border overflow-y-auto p-4 pt-14 transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-56 shrink-0 border-r border-dashed border-border overflow-y-auto p-4">
        {nav}
      </aside>
    </>
  )
}
