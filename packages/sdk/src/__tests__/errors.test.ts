import { describe, it, expect } from "bun:test"
import { SuperserveError, APIError } from "../errors"

describe("Error Classes", () => {
  describe("SuperserveError", () => {
    it("should create error with message", () => {
      const error = new SuperserveError("Test error")
      expect(error.message).toBe("Test error")
      expect(error.name).toBe("SuperserveError")
    })

    it("should be instanceof Error", () => {
      const error = new SuperserveError("Test")
      expect(error instanceof Error).toBe(true)
    })

    it("should have stack trace", () => {
      const error = new SuperserveError("Test")
      expect(error.stack).toBeTruthy()
    })
  })

  describe("APIError", () => {
    it("should store status code", () => {
      const error = new APIError(404, "Not found")
      expect(error.status).toBe(404)
      expect(error.message).toBe("Not found")
    })

    it("should store details", () => {
      const details = { field: "email", reason: "invalid" }
      const error = new APIError(400, "Validation failed", details)
      expect(error.details).toEqual(details)
    })

    it("should have empty details if not provided", () => {
      const error = new APIError(500, "Server error")
      expect(error.details).toEqual({})
    })

    it("should be instanceof SuperserveError", () => {
      const error = new APIError(500, "Server error")
      expect(error instanceof SuperserveError).toBe(true)
    })

    it("should have APIError name", () => {
      const error = new APIError(500, "Server error")
      expect(error.name).toBe("APIError")
    })

    it("should handle various HTTP error codes", () => {
      const codes = [400, 401, 403, 404, 429, 500, 502, 503]
      for (const code of codes) {
        const error = new APIError(code, `Error ${code}`)
        expect(error.status).toBe(code)
      }
    })
  })

  describe("Error Serialization", () => {
    it("should serialize SuperserveError to JSON", () => {
      const error = new SuperserveError("Test")
      const json = JSON.stringify(error, null, 2)
      expect(json).toContain("Test")
    })

    it("should serialize APIError with details to JSON", () => {
      const error = new APIError(400, "Validation failed", {
        field: "email",
      })
      const json = JSON.stringify(error, null, 2)
      expect(json).toContain("Validation failed")
      expect(json).toContain("400")
    })
  })
})
