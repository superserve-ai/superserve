import type { CapturedNetworkRequest, CaptureResult } from "posthog-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  carriesInviteToken,
  redactCapturedRequest,
  redactInviteTokens,
  redactInviteTokensDeep,
  redactInviteTokensFromEvent,
  scrubPersistedInviteTokens,
  syncRecordingWithAddress,
} from "./invite-token-redaction"
import { registerPreviewTokenQueryParam } from "./preview-token-redaction"

const BODY = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"
const TOKEN = `ssinv_use_${BODY}`
const DASHED = "ssinv_usw_ab-cd_ef-gh_ij-kl_mn-op_qr-st_uv-wx_yz-AB_CD"

function event(properties: Record<string, unknown>): CaptureResult {
  return { uuid: "u", event: "$pageview", properties }
}

describe("redactInviteTokens", () => {
  it("redacts a raw token in a path", () => {
    const out = redactInviteTokens(`https://x.test/invite/${TOKEN}/`)
    expect(out).not.toContain(BODY)
    expect(out).toBe("https://x.test/invite/ssinv_redacted/")
  })

  it("redacts a token that contains - and _", () => {
    expect(redactInviteTokens(`/a?t=${DASHED}&b=1`)).toBe(
      "/a?t=ssinv_redacted&b=1",
    )
  })

  it("redacts a token inside a next= query parameter", () => {
    const out = redactInviteTokens(
      `/signin?next=${encodeURIComponent(`/invite/${TOKEN}/`)}`,
    )
    expect(out).not.toContain(BODY)
    expect(out).toContain("next=")
  })

  it("redacts a double-encoded token", () => {
    const once = encodeURIComponent(`/invite/${TOKEN}/`)
    const twice = encodeURIComponent(`/signin?next=${once}`)
    expect(redactInviteTokens(twice)).not.toContain(BODY)
  })

  it("redacts encoded underscores and hyphens in the token", () => {
    const encoded = DASHED.replace(/_/g, "%5F").replace(/-/g, "%2d")
    const out = redactInviteTokens(`/signin?x=${encoded}`)
    expect(out).not.toContain("ab")
  })

  it("is case-insensitive about the prefix", () => {
    expect(redactInviteTokens(`/x/SSINV_USE_${BODY}`)).not.toContain(BODY)
  })

  it("removes whatever sits in the /invite/ path segment", () => {
    expect(redactInviteTokens("/invite/not-a-recognised-shape/")).toBe(
      "/invite/ssinv_redacted/",
    )
  })

  it("leaves unrelated text untouched", () => {
    const text = "https://console.superserve.ai/sandboxes?x=1"
    expect(redactInviteTokens(text)).toBe(text)
    expect(redactInviteTokens("/user-management/")).toBe("/user-management/")
  })
})

describe("redactInviteTokensDeep", () => {
  it("redacts nested strings without mutating the input", () => {
    const input = { a: [{ href: `/invite/${TOKEN}/` }], b: 1, c: null }
    const out = redactInviteTokensDeep(input)
    expect(JSON.stringify(out)).not.toContain(BODY)
    expect(JSON.stringify(input)).toContain(BODY)
    expect(out.b).toBe(1)
  })

  it("returns the same reference when nothing changes", () => {
    const input = { a: ["x"], b: { c: "y" } }
    expect(redactInviteTokensDeep(input)).toBe(input)
  })
})

describe("scrubPersistedInviteTokens", () => {
  it.each([
    [
      "$initial_person_info",
      { r: `/invite/${TOKEN}/`, u: `/invite/${TOKEN}/` },
    ],
    ["$initial_referrer_info", { $referrer: `/invite/${TOKEN}/` }],
    [
      "$initial_campaign_params",
      { utm_content: TOKEN, custom: [{ next: encodeURIComponent(TOKEN) }] },
    ],
  ])("overwrites tokens in %s without mutating the value", (key, value) => {
    const properties: Record<string, unknown> = { [key]: value }
    const posthog = {
      get_property: vi.fn((name: string) => properties[name]),
      register: vi.fn((values: Record<string, unknown>) => {
        Object.assign(properties, values)
      }),
    }

    scrubPersistedInviteTokens(posthog)

    expect(posthog.register).toHaveBeenCalledExactlyOnceWith({
      [key]: redactInviteTokensDeep(value),
    })
    expect(JSON.stringify(properties)).not.toContain(TOKEN)
    expect(JSON.stringify(value)).toContain(TOKEN)

    scrubPersistedInviteTokens(posthog)
    expect(posthog.register).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, null, false, 42, "unchanged", new Date(0)])(
    "leaves missing or non-object values alone: %j",
    (value) => {
      const posthog = { get_property: vi.fn(() => value), register: vi.fn() }

      scrubPersistedInviteTokens(posthog)

      expect(posthog.get_property.mock.calls).toEqual([
        ["$initial_person_info"],
        ["$initial_referrer_info"],
        ["$initial_campaign_params"],
      ])
      expect(posthog.register).not.toHaveBeenCalled()
    },
  )

  it("keeps unrelated attribution unchanged", () => {
    const value = {
      r: "https://example.com/",
      u: "/sandboxes/",
      utm_source: "test",
    }
    const posthog = { get_property: vi.fn(() => value), register: vi.fn() }

    scrubPersistedInviteTokens(posthog)

    expect(posthog.register).not.toHaveBeenCalled()
  })
})

describe("redactInviteTokensFromEvent", () => {
  it("scrubs url, pathname, referrer and person properties", () => {
    const out = redactInviteTokensFromEvent({
      ...event({
        $current_url: `https://x.test/invite/${TOKEN}/`,
        $pathname: `/invite/${TOKEN}/`,
        $referrer: `https://x.test/signin?next=${encodeURIComponent(`/invite/${TOKEN}/`)}`,
        $initial_pathname: `/invite/${TOKEN}/`,
      }),
      $set_once: { first_landing_path: `/invite/${TOKEN}/` },
    })
    expect(JSON.stringify(out)).not.toContain(BODY)
    expect(out?.properties.$current_url).toBe(
      "https://x.test/invite/ssinv_redacted/",
    )
  })

  it("scrubs session-recording snapshot data", () => {
    const out = redactInviteTokensFromEvent(
      event({
        $snapshot_data: [{ type: 4, data: { href: `/invite/${TOKEN}/` } }],
      }),
    )
    expect(JSON.stringify(out)).not.toContain(BODY)
  })

  it("passes null through", () => {
    expect(redactInviteTokensFromEvent(null)).toBeNull()
  })
})

describe("redactCapturedRequest", () => {
  function request(name: string): CapturedNetworkRequest {
    return { name, duration: 0, entryType: "resource", startTime: 0 }
  }

  it("redacts invite tokens in captured request URLs", () => {
    const out = redactCapturedRequest(
      request(`https://x.test/invite/${TOKEN}/?next=${TOKEN}`),
    )
    expect(out.name).not.toContain(BODY)
  })

  it("still redacts preview tokens", () => {
    registerPreviewTokenQueryParam("superserve_preview_token")
    const out = redactCapturedRequest(
      request(`/invite/${TOKEN}/?superserve_preview_token=secret`),
    )
    expect(out.name).not.toContain("secret")
    expect(out.name).not.toContain(BODY)
  })

  it("returns the original request when nothing matches", () => {
    const original = request("https://x.test/sandboxes")
    expect(redactCapturedRequest(original)).toBe(original)
  })
})

describe("syncRecordingWithAddress", () => {
  const posthog = {
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
  }

  beforeEach(() => {
    posthog.startSessionRecording.mockReset()
    posthog.stopSessionRecording.mockReset()
    // Leave the module's paused flag cleared between tests.
    syncRecordingWithAddress(posthog, "https://x.test/")
    posthog.startSessionRecording.mockReset()
  })

  it("detects tokens in paths and encoded next parameters", () => {
    expect(carriesInviteToken(`https://x.test/invite/${TOKEN}/`)).toBe(true)
    expect(
      carriesInviteToken(
        `https://x.test/signin?next=${encodeURIComponent(`/invite/${TOKEN}/`)}`,
      ),
    ).toBe(true)
    expect(carriesInviteToken("https://x.test/sandboxes/")).toBe(false)
  })

  it("stops recording on a tokenised address and resumes after leaving it", () => {
    syncRecordingWithAddress(posthog, `https://x.test/invite/${TOKEN}/`)
    expect(posthog.stopSessionRecording).toHaveBeenCalledTimes(1)

    syncRecordingWithAddress(posthog, "https://x.test/sandboxes/")
    expect(posthog.startSessionRecording).toHaveBeenCalledTimes(1)

    syncRecordingWithAddress(posthog, "https://x.test/sandboxes/")
    expect(posthog.startSessionRecording).toHaveBeenCalledTimes(1)
  })

  it("never starts recording it did not pause", () => {
    syncRecordingWithAddress(posthog, "https://x.test/sandboxes/")
    expect(posthog.startSessionRecording).not.toHaveBeenCalled()
  })
})
