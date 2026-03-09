import { createHighlighter, type Highlighter } from "shiki"

let highlighterPromise: Promise<Highlighter> | null = null

const PRELOADED_LANGS = [
  "javascript",
  "typescript",
  "python",
  "json",
  "bash",
  "shell",
  "html",
  "css",
  "jsx",
  "tsx",
  "markdown",
  "yaml",
  "sql",
  "go",
  "rust",
  "toml",
] as const

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["vitesse-dark"],
      langs: [...PRELOADED_LANGS],
    })
  }
  return highlighterPromise
}

export async function highlightCode(
  code: string,
  lang: string,
): Promise<string> {
  const highlighter = await getHighlighter()
  const loadedLangs = highlighter.getLoadedLanguages()
  const effectiveLang = loadedLangs.includes(lang) ? lang : "text"

  return highlighter.codeToHtml(code, {
    lang: effectiveLang,
    theme: "vitesse-dark",
  })
}
