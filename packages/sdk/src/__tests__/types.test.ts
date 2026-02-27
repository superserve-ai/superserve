import { describe, it, expect } from "bun:test"
import type {
  SuperserveOptions,
  RunOptions,
  StreamOptions,
  SessionOptions,
} from "../types"

describe("Type Definitions", () => {
  describe("SuperserveOptions", () => {
    it("should require apiKey", () => {
      const options: SuperserveOptions = { apiKey: "test-key" }
      expect(options.apiKey).toBe("test-key")
    })

    it("should allow optional baseUrl", () => {
      const options: SuperserveOptions = {
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
      }
      expect(options.baseUrl).toBe("https://custom.api.com")
    })

    it("should allow optional timeout", () => {
      const options: SuperserveOptions = {
        apiKey: "test-key",
        timeout: 5000,
      }
      expect(options.timeout).toBe(5000)
    })
  })

  describe("RunOptions", () => {
    it("should require message", () => {
      const options: RunOptions = { message: "Hello" }
      expect(options.message).toBe("Hello")
    })

    it("should allow optional sessionId", () => {
      const options: RunOptions = {
        message: "Hello",
        sessionId: "sess_123",
      }
      expect(options.sessionId).toBe("sess_123")
    })

    it("should allow optional idleTimeout", () => {
      const options: RunOptions = {
        message: "Hello",
        idleTimeout: 600,
      }
      expect(options.idleTimeout).toBe(600)
    })
  })

  describe("StreamOptions", () => {
    it("should require message", () => {
      const options: StreamOptions = { message: "Hello" }
      expect(options.message).toBe("Hello")
    })

    it("should allow optional callbacks", () => {
      const onText = (text: string) => {}
      const onFinish = () => {}
      const options: StreamOptions = {
        message: "Hello",
        onText,
        onFinish,
      }
      expect(options.onText).toBe(onText)
      expect(options.onFinish).toBe(onFinish)
    })
  })

  describe("SessionOptions", () => {
    it("should be optional", () => {
      const options: SessionOptions = {}
      expect(options).toBeTruthy()
    })

    it("should allow optional title", () => {
      const options: SessionOptions = { title: "My Session" }
      expect(options.title).toBe("My Session")
    })

    it("should allow optional idleTimeout", () => {
      const options: SessionOptions = { idleTimeout: 1800 }
      expect(options.idleTimeout).toBe(1800)
    })
  })
})
