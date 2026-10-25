import { PendingReview } from "@/components/auth/pending-review"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  return (
    <PendingReview
      name="Example Applicant"
      email="applicant@example.com"
      meeting={
        state === "unavailable"
          ? { state: "unavailable" }
          : state === "signin"
            ? { state: "signin_required" }
            : {
                state: "booked",
                startTime: "2026-11-01T12:00:00Z",
                endTime: "2026-11-01T12:25:00Z",
                rescheduleUrl:
                  state === "no-link"
                    ? null
                    : "https://calendly.com/reschedulings/example-meeting",
              }
      }
    />
  )
}
