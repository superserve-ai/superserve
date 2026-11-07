import { FingerprintProvider as Provider } from "@fingerprint/react"
import { render } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("@fingerprint/react", () => ({
  FingerprintProvider: vi.fn(() => null),
}))

afterEach(() => {
  vi.unstubAllEnvs()
})

it("hashes URL paths, queries and fragments before sending them to Fingerprint", async () => {
  vi.stubEnv("NEXT_PUBLIC_FINGERPRINT_API_KEY", "test-public-key")
  const { FingerprintProvider } = await import("./fingerprint-provider")

  render(
    <FingerprintProvider>
      <span>Child</span>
    </FingerprintProvider>,
  )

  expect(Provider).toHaveBeenCalledOnce()
  expect(vi.mocked(Provider).mock.calls[0][0]).toMatchObject({
    urlHashing: { path: true, query: true, fragment: true },
  })
})
