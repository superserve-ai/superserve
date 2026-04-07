"use client"

import { useEffect, useState } from "react"
import { createHighlighter, type Highlighter } from "shiki"

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: ["typescript", "python", "go", "bash"],
    })
  }
  return highlighterPromise
}

const cache = new Map<string, string>()

async function highlight(code: string, lang: string): Promise<string> {
  const key = `${lang}:${code}`
  const cached = cache.get(key)
  if (cached) return cached

  const highlighter = await getHighlighter()
  const html = highlighter.codeToHtml(code, {
    lang,
    theme: "github-dark-default",
  })
  cache.set(key, html)
  return html
}

interface HighlightedCodeProps {
  code: string
  lang: "typescript" | "python" | "go" | "bash"
}

export function HighlightedCode({ code, lang }: HighlightedCodeProps) {
  const [html, setHtml] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    highlight(code, lang).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  if (html) {
    return (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-generated HTML
      <div
        className="overflow-x-auto font-mono text-sm leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-foreground/80 whitespace-pre">
      <code>{code}</code>
    </pre>
  )
}
