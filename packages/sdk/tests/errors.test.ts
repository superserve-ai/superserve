import { describe, expect, it } from "vitest"

import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  SandboxError,
  ServerError,
  TimeoutError,
  ValidationError,
  mapApiError,
} from "../src/errors.js"

describe("error hierarchy", () => {
  it("each typed error extends SandboxError", () => {
    expect(new AuthenticationError()).toBeInstanceOf(SandboxError)
    expect(new ValidationError("bad input")).toBeInstanceOf(SandboxError)
    expect(new NotFoundError()).toBeInstanceOf(SandboxError)
    expect(new ConflictError()).toBeInstanceOf(SandboxError)
    expect(new TimeoutError()).toBeInstanceOf(SandboxError)
    expect(new ServerError()).toBeInstanceOf(SandboxError)
  })

  it("sets name correctly on each subclass", () => {
    expect(new AuthenticationError().name).toBe("AuthenticationError")
    expect(new ValidationError("x").name).toBe("ValidationError")
    expect(new NotFoundError().name).toBe("NotFoundError")
    expect(new ConflictError().name).toBe("ConflictError")
    expect(new TimeoutError().name).toBe("TimeoutError")
    expect(new ServerError().name).toBe("ServerError")
    expect(new SandboxError("boom").name).toBe("SandboxError")
  })

  it("stores cause when provided", () => {
    const cause = new Error("root")
    const err = new SandboxError("wrap", 500, undefined, { cause })
    expect((err as { cause?: unknown }).cause).toBe(cause)
  })
})

describe("mapApiError", () => {
  const withError = (code: string, message: string) => ({
    error: { code, message },
  })

  it("maps 400 to ValidationError with code", () => {
    const err = mapApiError(400, withError("bad_request", "no"))
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe("bad_request")
    expect(err.message).toBe("no")
  })

  it("maps 401 to AuthenticationError with code", () => {
    const err = mapApiError(401, withError("unauthorized", "go away"))
    expect(err).toBeInstanceOf(AuthenticationError)
    expect(err.code).toBe("unauthorized")
  })

  it("maps 404 to NotFoundError with code", () => {
    const err = mapApiError(404, withError("not_found", "gone"))
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.code).toBe("not_found")
  })

  it("maps 409 to ConflictError with code", () => {
    const err = mapApiError(409, withError("conflict", "wrong state"))
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.code).toBe("conflict")
  })

  it("maps 429 to base SandboxError", () => {
    const err = mapApiError(429, withError("rate_limited", "slow down"))
    expect(err).toBeInstanceOf(SandboxError)
    // Not one of the more specific subclasses
    expect(err).not.toBeInstanceOf(ValidationError)
    expect(err).not.toBeInstanceOf(ServerError)
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe("rate_limited")
  })

  it("maps 500 to ServerError", () => {
    const err = mapApiError(500, withError("server_error", "boom"))
    expect(err).toBeInstanceOf(ServerError)
    expect(err.statusCode).toBe(500)
  })

  it("maps 502 to ServerError", () => {
    const err = mapApiError(502, withError("bad_gateway", "upstream"))
    expect(err).toBeInstanceOf(ServerError)
  })

  it("unknown 4xx status falls back to base SandboxError", () => {
    const err = mapApiError(418, withError("teapot", "short and stout"))
    expect(err).toBeInstanceOf(SandboxError)
    expect(err).not.toBeInstanceOf(ValidationError)
    expect(err.statusCode).toBe(418)
  })

  it("uses default message when body lacks error", () => {
    const err = mapApiError(400, {})
    expect(err.message).toBe("API error (400)")
  })
})
