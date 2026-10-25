import "server-only"
import { z } from "zod"

export type EnterpriseMeeting =
  | { state: "signin_required" | "unavailable" | "not_booked" }
  | {
      state: "booked"
      startTime: string
      endTime: string
      rescheduleUrl: string | null
    }

const uri = (kind: string) =>
  z
    .string()
    .regex(new RegExp(`^https://api\\.calendly\\.com/${kind}/[A-Za-z0-9-]+$`))
const eventSchema = z.object({
  uri: uri("scheduled_events"),
  event_type: uri("event_types"),
  status: z.enum(["active", "canceled"]),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
})
const pagination = z.object({ next_page_token: z.string().nullable() })
const eventsSchema = z.object({
  collection: z.array(eventSchema).max(100),
  pagination,
})
const inviteesSchema = z.object({
  collection: z
    .array(
      z.object({
        email: z.string().email(),
        status: z.enum(["active", "canceled"]),
        reschedule_url: z.string().nullable(),
      }),
    )
    .max(100),
  pagination,
})

function rescheduleUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.origin === "https://calendly.com" &&
      !url.username &&
      !url.password &&
      /^\/reschedulings\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? value
      : null
  } catch {
    return null
  }
}

export async function lookupEnterpriseMeeting(
  email: string,
): Promise<EnterpriseMeeting> {
  const token = process.env.CALENDLY_API_TOKEN
  const organization = process.env.CALENDLY_ORGANIZATION_URI
  const eventType = process.env.CALENDLY_ENTERPRISE_EVENT_TYPE_URI
  if (
    !token ||
    !uri("organizations").safeParse(organization).success ||
    !uri("event_types").safeParse(eventType).success
  )
    return { state: "unavailable" }
  const deadline = Date.now() + 10_000
  async function read(path: string, params: Record<string, string>) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("Meeting lookup unavailable")
    const url = new URL(path, "https://api.calendly.com")
    url.search = new URLSearchParams(params).toString()
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(5000, remaining)),
    })
    if (!response.ok) throw new Error("Meeting lookup unavailable")
    return response.json()
  }
  try {
    let page = ""
    for (let index = 0; index < 3; index++) {
      const events = eventsSchema.parse(
        await read("/scheduled_events", {
          organization: organization!,
          invitee_email: email,
          status: "active",
          sort: "start_time:desc",
          count: "100",
          ...(page ? { page_token: page } : {}),
        }),
      )
      for (const event of events.collection) {
        if (event.status !== "active" || event.event_type !== eventType)
          continue
        let inviteePage = ""
        for (let inviteeIndex = 0; inviteeIndex < 3; inviteeIndex++) {
          const invitees = inviteesSchema.parse(
            await read(new URL(event.uri).pathname + "/invitees", {
              status: "active",
              count: "100",
              ...(inviteePage ? { page_token: inviteePage } : {}),
            }),
          )
          const invitee = invitees.collection.find(
            (item) =>
              item.status === "active" &&
              item.email.trim().toLowerCase() === email.trim().toLowerCase(),
          )
          if (invitee)
            return {
              state: "booked",
              startTime: event.start_time,
              endTime: event.end_time,
              rescheduleUrl: rescheduleUrl(invitee.reschedule_url),
            }
          if (!invitees.pagination.next_page_token) break
          inviteePage = invitees.pagination.next_page_token
          if (inviteeIndex === 2) return { state: "unavailable" }
        }
      }
      if (!events.pagination.next_page_token) return { state: "not_booked" }
      page = events.pagination.next_page_token
    }
  } catch {
    return { state: "unavailable" }
  }
  return { state: "unavailable" }
}
