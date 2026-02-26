import { describe, expect, test } from "bun:test"
import { APIError, SuperserveError } from "../src/errors"

describe("SuperserveError", () => {
  test("creates error with message", () => {
    const error = new SuperserveError("something went wrong")
    expect(error.message).toBe("something went wrong")
    expect(error.name).toBe("SuperserveError")
  })

  test("is an instance of Error", () => {
    const error = new SuperserveError("test")
    expect(error).toBeInstanceOf(Error)
  })
})

describe("APIError", () => {
  test("creates error with status and message", () => {
    const error = new APIError(404, "Not found")
    expect(error.status).toBe(404)
    expect(error.message).toBe("Not found")
    expect(error.name).toBe("APIError")
    expect(error.details).toEqual({})
  })

  test("creates error with details", () => {
    const details = { field: "name", reason: "required" }
    const error = new APIError(400, "Bad request", details)
    expect(error.details).toEqual(details)
  })

  test("defaults details to empty object", () => {
    const error = new APIError(500, "Server error")
    expect(error.details).toEqual({})
  })

  test("extends SuperserveError", () => {
    const error = new APIError(500, "Server error")
    expect(error).toBeInstanceOf(SuperserveError)
    expect(error).toBeInstanceOf(Error)
  })
})
