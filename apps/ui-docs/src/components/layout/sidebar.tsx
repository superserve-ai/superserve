import { ListIcon, XIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useState } from "react"
import { Link, useParams } from "react-router"

import { categories, getByCategory } from "../../registry"

function Logo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      <rect width="18" height="18" fill="currentColor" />
      <text
        x="4"
        y="14"
        fill="var(--color-background)"
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--sans-font), system-ui, sans-serif"
      >
        S
      </text>
    </svg>
  )
}

export function Sidebar() {
  const { slug } = useParams()
  const [open, setOpen] = useState(false)

  const nav = (
    <>
      <Link
        to="/"
        className="mb-6 flex items-center gap-2.5"
        onClick={() => setOpen(false)}
      >
        <Logo />
        <span className="text-sm font-semibold text-foreground">
          Superserve UI
        </span>
      </Link>
      <nav className="space-y-6">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="mb-2 font-mono text-xs tracking-widest text-muted uppercase">
              {cat}
            </p>
            <div className="ml-px space-y-px border-l border-border/50">
              {getByCategory(cat).map((item) => {
                const isActive = slug === item.slug
                return (
                  <Link
                    key={item.slug}
                    to={`/components/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className={`-ml-px block border-l py-1 pl-3 text-sm transition-colors ${
                      isActive
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted hover:border-border hover:text-foreground"
                    }`}
                  >
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile toggle */}
      <div className="fixed top-3 left-3 z-50 md:hidden">
        <Button variant="outline" size="icon-sm" onClick={() => setOpen(!open)}>
          {open ? (
            <XIcon className="size-4" weight="light" />
          ) : (
            <ListIcon className="size-4" weight="light" />
          )}
        </Button>
      </div>

      {/* Mobile overlay */}
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
          onKeyDown={() => {}}
          role="presentation"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 overflow-y-auto border-r border-border bg-background p-5 pt-14 transition-transform md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border p-5 md:block">
        {nav}
      </aside>
    </>
  )
}
