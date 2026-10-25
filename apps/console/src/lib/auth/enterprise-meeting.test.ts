import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { lookupEnterpriseMeeting } from "./enterprise-meeting"

const eventType = "https://api.calendly.com/event_types/example-enterprise"
const event = {
  uri: "https://api.calendly.com/scheduled_events/example-event",
  event_type: eventType,
  status: "active",
  start_time: "2026-11-01T12:00:00Z",
  end_time: "2026-11-01T12:25:00Z",
}
const invitee = {
  email: "applicant@example.com",
  status: "active",
  reschedule_url: "https://calendly.com/reschedulings/example-invitee",
}
const page = (collection: unknown[], next: string | null = null) => ({
  collection,
  pagination: { next_page_token: next },
})
const fetchMock = vi.fn()
const reply = (value: unknown) => ({ ok: true, json: async () => value })
beforeEach(() => {
  vi.stubEnv("CALENDLY_API_TOKEN", "example-token")
  vi.stubEnv(
    "CALENDLY_ORGANIZATION_URI",
    "https://api.calendly.com/organizations/example-org",
  )
  vi.stubEnv("CALENDLY_ENTERPRISE_EVENT_TYPE_URI", eventType)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("finds existing account booking on every lookup, using only provider reschedule URL", async () => {
  fetchMock.mockImplementation(async (url: URL) =>
    reply(url.pathname.endsWith("/invitees") ? page([invitee]) : page([event])),
  )
  const first = await lookupEnterpriseMeeting(invitee.email)
  expect(first).toEqual({
    state: "booked",
    startTime: event.start_time,
    endTime: event.end_time,
    rescheduleUrl: invitee.reschedule_url,
  })
  expect(await lookupEnterpriseMeeting(invitee.email)).toEqual(first)
  const [url, options] = fetchMock.mock.calls[0]
  expect(url.origin).toBe("https://api.calendly.com")
  expect(url.searchParams.get("invitee_email")).toBe(invitee.email)
  expect(url.searchParams.get("organization")).toContain("example-org")
  expect(options).toMatchObject({ cache: "no-store", redirect: "error" })
})
it("does not attach another email, canceled invitee, or different event type", async () => {
  fetchMock
    .mockResolvedValueOnce(
      reply(
        page([
          {
            ...event,
            event_type: "https://api.calendly.com/event_types/other",
          },
          event,
        ]),
      ),
    )
    .mockResolvedValueOnce(
      reply(
        page([
          { ...invitee, email: "other@example.com" },
          { ...invitee, status: "canceled" },
        ]),
      ),
    )
  expect(await lookupEnterpriseMeeting(invitee.email)).toEqual({
    state: "not_booked",
  })
})
it("follows provider pagination without following arbitrary provider URLs", async () => {
  fetchMock
    .mockResolvedValueOnce(reply(page([], "next-page")))
    .mockResolvedValueOnce(reply(page([event])))
    .mockResolvedValueOnce(reply(page([invitee])))
  expect((await lookupEnterpriseMeeting(invitee.email)).state).toBe("booked")
  expect(fetchMock.mock.calls[1][0].searchParams.get("page_token")).toBe(
    "next-page",
  )
})
it("does not fabricate reschedule URLs or replace actual booking with another invitation", async () => {
  fetchMock.mockResolvedValueOnce(reply(page([event]))).mockResolvedValueOnce(
    reply(
      page([
        {
          ...invitee,
          reschedule_url: "https://example.com/reschedulings/unsafe",
        },
      ]),
    ),
  )
  expect(await lookupEnterpriseMeeting(invitee.email)).toMatchObject({
    state: "booked",
    rescheduleUrl: null,
  })
})
it("keeps provider errors, malformed bodies and incomplete pagination unavailable, not unbooked", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false })
  expect((await lookupEnterpriseMeeting(invitee.email)).state).toBe(
    "unavailable",
  )
  fetchMock.mockResolvedValueOnce(reply({ collection: [] }))
  expect((await lookupEnterpriseMeeting(invitee.email)).state).toBe(
    "unavailable",
  )
  fetchMock.mockResolvedValue(reply(page([], "still-more")))
  expect((await lookupEnterpriseMeeting(invitee.email)).state).toBe(
    "unavailable",
  )
})
it("does not call provider without configured account and event bindings", async () => {
  vi.stubEnv("CALENDLY_API_TOKEN", "")
  expect((await lookupEnterpriseMeeting(invitee.email)).state).toBe(
    "unavailable",
  )
  expect(fetchMock).not.toHaveBeenCalled()
})
