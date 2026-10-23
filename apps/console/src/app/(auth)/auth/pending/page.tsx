import { PendingReview } from "@/components/auth/pending-review"
import { readPendingProfile } from "@/lib/auth/signup-review-server"

export default async function PendingPage() {
  const { name, email } = await readPendingProfile()
  return <PendingReview name={name} email={email} />
}
