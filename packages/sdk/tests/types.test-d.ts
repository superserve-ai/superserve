import { describe, expectTypeOf, it } from "vitest"

import type { BuildLogEvent, BuildLogStream } from "../src/index"

describe("BuildLogStream", () => {
  it("includes the error stream that a failed build sends", () => {
    expectTypeOf<BuildLogStream>().toEqualTypeOf<
      "stdout" | "stderr" | "system" | "error"
    >()
    expectTypeOf<BuildLogEvent["stream"]>().toEqualTypeOf<BuildLogStream>()
  })
})
