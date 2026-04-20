import { describe, expect, it } from "vitest"
import { formatBuildError } from "./format-build-error"

describe("formatBuildError", () => {
  it("humanizes image_pull_failed", () => {
    expect(
      formatBuildError("image_pull_failed: manifest not found for python:3.99"),
    ).toEqual({
      title: "Failed to pull base image",
      detail: "manifest not found for python:3.99",
    })
  })

  it("humanizes step_failed", () => {
    expect(
      formatBuildError("step_failed: step 1/2 failed after 3s: exit 100"),
    ).toEqual({
      title: "A build step failed",
      detail: "step 1/2 failed after 3s: exit 100",
    })
  })

  it("falls back cleanly on unknown codes", () => {
    expect(formatBuildError("something_weird: oops")).toEqual({
      title: "Build failed",
      detail: "oops",
    })
  })

  it("falls back when there is no code prefix", () => {
    expect(formatBuildError("plain error message")).toEqual({
      title: "Build failed",
      detail: "plain error message",
    })
  })

  it("handles undefined", () => {
    expect(formatBuildError(undefined)).toEqual({
      title: "Build failed",
      detail: "",
    })
  })

  it("handles null", () => {
    expect(formatBuildError(null)).toEqual({
      title: "Build failed",
      detail: "",
    })
  })
})
