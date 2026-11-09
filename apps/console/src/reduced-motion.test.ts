import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { parse } from "postcss"
import { describe, expect, it } from "vitest"

const sourceRoot = path.resolve("src")

function unguardedAnimations(source: string) {
  return source.split("\n").flatMap((line, index) =>
    Array.from(
      line.matchAll(
        /(?:[\w-]+:)*\banimate-(?:(?:pulse|ping|spin|bounce)\b|\[[^\]\r\n]+\])/g,
      ),
    )
      .filter((match) => !match[0].split(":").includes("motion-safe"))
      .map((match) => `${index + 1}: ${match[0]}`),
  )
}

function infiniteMotionLoops(source: string) {
  return Array.from(
    source.matchAll(/\brepeat\s*:\s*(?:Number\.POSITIVE_INFINITY|Infinity)\b/g),
    (match) =>
      `${source.slice(0, match.index).split("\n").length}: ${match[0]}`,
  )
}

describe("reduced motion guards", () => {
  it("requires motion-safe for keyframe animation utilities and forbids infinite motion loops in source", () => {
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
      .flatMap((file) => {
        const source = readFileSync(path.join(sourceRoot, file), "utf8")
        return [
          ...unguardedAnimations(source),
          ...infiniteMotionLoops(source),
        ].map((violation) => `${file}:${violation}`)
      })

    expect(violations, violations.join("\n")).toEqual([])
  })

  it("detects both forms of infinite motion loops", () => {
    expect(
      infiniteMotionLoops(
        "transition={{ repeat: Infinity }}\ntransition={{\n  repeat: Number.POSITIVE_INFINITY,\n}}\ntransition={{ repeat:\n  Infinity }}",
      ),
    ).toEqual([
      "1: repeat: Infinity",
      "3: repeat: Number.POSITIVE_INFINITY",
      "5: repeat:\n  Infinity",
    ])
    expect(infiniteMotionLoops("transition={{ repeat: 3 }}")).toEqual([])
  })

  it("detects unguarded utilities in conditional and template strings", () => {
    expect(
      unguardedAnimations(
        '`${fetching ? "animate-spin" : ""}`\nconnecting ? "animate-pulse bg-orange-400" : "bg-red-500"\n"hover:animate-ping animate-bounce"\n"animate-[spin_0.8s_linear_infinite] hover:animate-[pulse_2s_ease-in-out_infinite]"',
      ),
    ).toEqual([
      "1: animate-spin",
      "2: animate-pulse",
      "3: hover:animate-ping",
      "3: animate-bounce",
      "4: animate-[spin_0.8s_linear_infinite]",
      "4: hover:animate-[pulse_2s_ease-in-out_infinite]",
    ])
    expect(
      unguardedAnimations(
        "motion-safe:animate-spin hover:motion-safe:animate-pulse motion-safe:hover:animate-ping motion-safe:animate-bounce motion-reduce:animate-none motion-safe:animate-[spin_0.8s_linear_infinite] hover:motion-safe:animate-[pulse_2s_ease-in-out_infinite]",
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
