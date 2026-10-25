import { PendingReview } from "@/components/auth/pending-review"
import { readPendingMeeting } from "@/lib/auth/pending-meeting-server"
import { readPendingProfile } from "@/lib/auth/signup-review-server"

export default async function PendingPage() {
  const [{ name, email }, meeting] = await Promise.all([
    readPendingProfile(),
    readPendingMeeting(),
  ])
  return (
    <PendingReview
      name={name}
      email={meeting.accountEmail ?? email}
      meeting={meeting}
    />
  )
}
