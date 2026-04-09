import { WarningIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@superserve/ui"
import Image from "next/image"
import Link from "next/link"
import { CornerBrackets } from "@/components/corner-brackets"

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="mb-6">
        <Link href="/">
          <Image
            src="/logo.svg"
            alt="Superserve"
            width={200}
            height={40}
            className="h-8 w-auto"
          />
        </Link>
      </div>

      <div className="relative w-full max-w-sm border border-dashed border-border bg-surface p-6">
        <CornerBrackets size="lg" />

        <div className="flex flex-col items-center">
          <WarningIcon className="mb-3 size-8 text-muted" weight="light" />
          <h1 className="text-center text-sm font-medium text-foreground">
            Authentication Error
          </h1>
          <p className="mt-2 text-center text-xs text-muted">
            Something went wrong during sign in. Please try again.
          </p>
          <Button
            render={<Link href="/auth/signin" />}
            size="sm"
            className="mt-5"
          >
            Try Again
          </Button>
        </div>
      </div>
    </div>
  )
}
