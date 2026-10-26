import { afterEach, describe, expect, it, vi } from "vitest"

const UUID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"

async function loadWithEnv(env: Record<string, string>) {
  vi.resetModules()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  return import("./sandbox-url")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("regionFromSandboxId", () => {
  it("extracts the region token from a prefixed id", async () => {
    const { regionFromSandboxId } = await loadWithEnv({})
    expect(regionFromSandboxId(`sb-usw-${UUID}`)).toBe("usw")
    expect(regionFromSandboxId(`sb-use-${UUID}`)).toBe("use")
  })

  it("returns undefined for legacy/bare ids", async () => {
    const { regionFromSandboxId } = await loadWithEnv({})
    expect(regionFromSandboxId(UUID)).toBeUndefined()
    expect(regionFromSandboxId("sbx-1")).toBeUndefined()
  })
})

describe("sandboxUuidFromId", () => {
  it("strips the region prefix from a public id", async () => {
    const { sandboxUuidFromId } = await loadWithEnv({})
    expect(sandboxUuidFromId(`sb-usw-${UUID}`)).toBe(UUID)
    expect(sandboxUuidFromId(`sb-constructor-${UUID}`)).toBe(UUID)
  })

  it("returns bare and unrecognised ids unchanged", async () => {
    const { sandboxUuidFromId } = await loadWithEnv({})
    expect(sandboxUuidFromId(UUID)).toBe(UUID)
    expect(sandboxUuidFromId("sb-usw-not-a-uuid")).toBe("sb-usw-not-a-uuid")
  })
})

describe("sandboxUrl", () => {
  const unset = {
    NEXT_PUBLIC_SANDBOX_SCHEME: "",
    NEXT_PUBLIC_SANDBOX_HOST: "",
    NEXT_PUBLIC_SANDBOX_PORT: "",
  }

  it("defaults to the production HTTPS/WSS host without a port", async () => {
    const { sandboxUrl } = await loadWithEnv(unset)
    expect(sandboxUrl(UUID, "boxd", "http")).toBe(
      `https://boxd-${UUID}.sandbox.superserve.ai`,
    )
    expect(sandboxUrl(UUID, "boxd", "ws")).toBe(
      `wss://boxd-${UUID}.sandbox.superserve.ai`,
    )
    expect(sandboxUrl(`sb-use-${UUID}`, "3000", "http")).toBe(
      `https://3000-sb-use-${UUID}.sandbox.superserve.ai`,
    )
  })

  it("uses the configured scheme, host and port for the default cell", async () => {
    const { sandboxUrl } = await loadWithEnv({
      NEXT_PUBLIC_SANDBOX_SCHEME: "http",
      NEXT_PUBLIC_SANDBOX_HOST: "sandbox.localhost",
      NEXT_PUBLIC_SANDBOX_PORT: "8090",
    })
    expect(sandboxUrl(UUID, "boxd", "ws")).toBe(
      `ws://boxd-${UUID}.sandbox.localhost:8090`,
    )
    expect(sandboxUrl(`sb-use-${UUID}`, "3000", "http")).toBe(
      `http://3000-sb-use-${UUID}.sandbox.localhost:8090`,
    )
  })

  it("routes a usw sandbox to the usw HTTPS host regardless of the default-cell config", async () => {
    const { sandboxUrl } = await loadWithEnv({
      NEXT_PUBLIC_SANDBOX_SCHEME: "http",
      NEXT_PUBLIC_SANDBOX_HOST: "sandbox.localhost",
      NEXT_PUBLIC_SANDBOX_PORT: "8090",
    })
    expect(sandboxUrl(`sb-usw-${UUID}`, "boxd", "ws")).toBe(
      `wss://boxd-sb-usw-${UUID}.usw-sandbox.superserve.ai`,
    )
  })

  it("does not resolve an inherited object property as a region", async () => {
    const { sandboxUrl } = await loadWithEnv(unset)
    expect(sandboxUrl(`sb-constructor-${UUID}`, "boxd", "http")).toBe(
      `https://boxd-sb-constructor-${UUID}.sandbox.superserve.ai`,
    )
  })

  it.each([
    [{ NEXT_PUBLIC_SANDBOX_SCHEME: "wss" }, /NEXT_PUBLIC_SANDBOX_SCHEME/],
    [{ NEXT_PUBLIC_SANDBOX_PORT: "80a" }, /NEXT_PUBLIC_SANDBOX_PORT/],
    [{ NEXT_PUBLIC_SANDBOX_PORT: "0" }, /NEXT_PUBLIC_SANDBOX_PORT/],
    [{ NEXT_PUBLIC_SANDBOX_PORT: "65536" }, /NEXT_PUBLIC_SANDBOX_PORT/],
  ])("rejects invalid configuration %o", async (env, message) => {
    await expect(loadWithEnv({ ...unset, ...env })).rejects.toThrow(message)
  })
})
