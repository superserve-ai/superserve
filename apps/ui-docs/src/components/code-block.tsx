import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { Button } from "@superserve/ui"
import { useEffect, useState } from "react"
import { createHighlighter, type Highlighter } from "shiki"

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-default"],
      langs: ["tsx"],
    })
  }
  return highlighterPromise
}

const highlightCache = new Map<string, string>()

async function highlight(code: string): Promise<string> {
  const cached = highlightCache.get(code)
  if (cached) return cached

  const highlighter = await getHighlighter()
  const html = highlighter.codeToHtml(code, {
    lang: "tsx",
    theme: "github-dark-default",
  })
  highlightCache.set(code, html)
  return html
}

export function CodeBlock({ code }: { code: string }) {
  const [html, setHtml] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    highlight(code).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
  }

  return (
    <div className="group relative">
      <Button
        variant="link"
        size="icon-sm"
        className="absolute top-2 right-2 z-10 text-neutral-200 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleCopy}
      >
        {copied ? (
          <CheckIcon className="size-3.5" weight="light" />
        ) : (
          <CopyIcon className="size-3.5" weight="light" />
        )}
      </Button>
      <div className="overflow-x-auto border border-border bg-[#0d1117] px-4 py-3 font-mono text-xs leading-relaxed [&_code]:!bg-transparent [&_pre]:!bg-transparent">
        {html ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-generated HTML
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="text-neutral-400">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
