import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { parse } from "postcss"
import { describe, expect, it } from "vitest"

const sourceRoot = path.resolve("src")

function unguardedAnimations(source: string) {
  return source.split("\n").flatMap((line, index) =>
    Array.from(
      line.matchAll(/(?:[\w-]+:)*\banimate-(?:pulse|ping|spin|bounce)\b/g),
    )
      .filter((match) => !match[0].split(":").includes("motion-safe"))
      .map((match) => `${index + 1}: ${match[0]}`),
  )
}

describe("reduced motion guards", () => {
  it("requires motion-safe for keyframe animation utilities in source", () => {
    const violations = readdirSync(sourceRoot, {
      recursive: true,
      encoding: "utf8",
    })
      .filter(
        (file) =>
          /\.(?:[cm]?[jt]sx?|mdx)$/.test(file) &&
          !/\.(?:test|spec)\./.test(file) &&
          !file.startsWith(`test${path.sep}`),
      )
      .flatMap((file) =>
        unguardedAnimations(
          readFileSync(path.join(sourceRoot, file), "utf8"),
        ).map((violation) => `${file}:${violation}`),
      )

    expect(violations, violations.join("\n")).toEqual([])
  })

  it("detects unguarded utilities in conditional and template strings", () => {
    expect(
      unguardedAnimations(
        '`${fetching ? "animate-spin" : ""}`\nconnecting ? "animate-pulse bg-orange-400" : "bg-red-500"\n"hover:animate-ping animate-bounce"',
      ),
    ).toEqual([
      "1: animate-spin",
      "2: animate-pulse",
      "3: hover:animate-ping",
      "3: animate-bounce",
    ])
    expect(
      unguardedAnimations(
        "motion-safe:animate-spin hover:motion-safe:animate-pulse motion-safe:hover:animate-ping motion-safe:animate-bounce motion-reduce:animate-none",
      ),
    ).toEqual([])
  })

  it("wraps all root body content in MotionProvider", () => {
    const layout = readFileSync(path.join(sourceRoot, "app/layout.tsx"), "utf8")
    expect(layout).toContain(
      'import { MotionProvider } from "@/components/motion-provider"',
    )
    const body = layout.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1]
    expect(body).toMatch(/^\s*<MotionProvider>[\s\S]*<\/MotionProvider>\s*$/)
  })

  it("disables shared UI keyframe animations only in the reduce media query", () => {
    const css = parse(
      readFileSync(path.join(sourceRoot, "app/globals.css"), "utf8"),
    )
    const selectors: string[] = []
    css.walkRules((rule) => {
      if (!/\.animate-(?:spin|ping|pulse|bounce)\b/.test(rule.selector)) return

      const media = rule.parent
      expect(media?.type).toBe("atrule")
      if (media?.type !== "atrule") return
      expect(media.name).toBe("media")
      expect(media.params).toBe("(prefers-reduced-motion: reduce)")
      expect(media.parent).toBe(css)
      expect(rule.nodes).toEqual([
        expect.objectContaining({
          type: "decl",
          prop: "animation",
          value: "none",
        }),
      ])
      selectors.push(...rule.selectors)
    })
    expect(selectors.toSorted()).toEqual([
      ".animate-bounce",
      ".animate-ping",
      ".animate-pulse",
      ".animate-spin",
    ])
  })
})
