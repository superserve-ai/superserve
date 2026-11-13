import type { Icon } from "@phosphor-icons/react"
import Image from "next/image"
import type { ReactNode } from "react"

import { CornerBrackets } from "./corner-brackets"

interface StatusPageProps {
  icon: Icon
  /** Small mono label above the title, e.g. "404". */
  code?: string
  title: string
  description: string
  /** Links or buttons that lead the user out of the page. */
  children?: ReactNode
}

/**
 * Full-screen page for app-level states with no dashboard shell around them,
 * such as an unknown URL or a crash in the root layout.
 */
export function StatusPage({
  icon: IconComponent,
  code,
  title,
  description,
  children,
}: StatusPageProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-foreground">
      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={120}
            height={24}
            className="h-6 w-auto"
          />
        </div>

        <div className="flex flex-col items-center text-center">
          <IconComponent
            className="mb-3 size-8 text-muted"
            weight="light"
            aria-hidden
          />
          {code && (
            <p className="mb-1 font-mono text-xs tracking-wider text-muted uppercase">
              {code}
            </p>
          )}
          <h1 className="text-sm font-medium text-foreground">{title}</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {description}
          </p>
          {children && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
