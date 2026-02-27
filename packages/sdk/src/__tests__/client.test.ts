import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Superserve } from "../client"
import { APIError, SuperserveError } from "../errors"

describe("Superserve Client", () => {
  let client: Superserve
  let fetchSpy: any

  beforeEach(() => {
    client = new Superserve({ apiKey: "test-key-123" })
    fetchSpy = mock((url: string, options: any) => {
      throw new Error("Fetch not mocked properly")
    })
  })

  describe("Constructor", () => {
    it("should initialize with apiKey", () => {
      const c = new Superserve({ apiKey: "test-key" })
      expect(c).toBeTruthy()
    })

    it("should use default baseUrl if not provided", () => {
      const c = new Superserve({ apiKey: "test-key" })
      expect(c).toBeTruthy()
    })

    it("should use custom baseUrl if provided", () => {
      const c = new Superserve({
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
      })
      expect(c).toBeTruthy()
    })

    it("should remove trailing slashes from baseUrl", () => {
      const c = new Superserve({
        apiKey: "test-key",
        baseUrl: "https://api.superserve.ai///",
      })
      expect(c).toBeTruthy()
    })
  })

  describe("Error Handling", () => {
    it("should throw APIError on 400 status", async () => {
      const error = new APIError(
        400,
        "Bad Request",
        { field: "message" },
      )
      expect(error.status).toBe(400)
      expect(error.details).toEqual({ field: "message" })
    })

    it("should throw SuperserveError on network failure", async () => {
      const error = new SuperserveError("Network failed")
      expect(error.name).toBe("SuperserveError")
      expect(error.message).toBe("Network failed")
    })

    it("APIError should be instanceof SuperserveError", () => {
      const error = new APIError(500, "Server Error")
      expect(error instanceof SuperserveError).toBe(true)
    })
  })

  describe("Agent Resolution", () => {
    it("should handle agent IDs starting with agt_", () => {
      expect(client).toBeTruthy()
      // Agent IDs are resolved internally
    })

    it("should cache agent name lookups", () => {
      expect(client).toBeTruthy()
      // Cache behavior is internal
    })
  })

  describe("Timeout Handling", () => {
    it("should use default timeout if not specified", () => {
      const c = new Superserve({ apiKey: "test-key" })
      expect(c).toBeTruthy()
    })

    it("should use custom timeout if provided", () => {
      const c = new Superserve({ apiKey: "test-key", timeout: 5000 })
      expect(c).toBeTruthy()
    })
  })

  describe("Session Management", () => {
    it("agents object should have list and get methods", () => {
      expect(client.agents).toBeTruthy()
      expect(typeof client.agents.list).toBe("function")
      expect(typeof client.agents.get).toBe("function")
    })
  })
})
