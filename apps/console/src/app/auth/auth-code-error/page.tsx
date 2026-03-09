import { Button, Card, CardContent } from "@superserve/ui"
import Link from "next/link"

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="text-center p-8">
          <h1 className="text-2xl font-bold mb-4">Authentication Error</h1>
          <p className="text-muted mb-6">
            Something went wrong during sign in. Please try again.
          </p>
          <Button asChild>
            <Link href="/auth/signin">Try Again</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
