import type { ExecStreamEvent } from "./types"

export async function* parseSSEStream(
  response: Response,
): AsyncIterableIterator<ExecStreamEvent> {
  if (!response.body) {
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes("\n")) {
        const newlineIdx = buffer.indexOf("\n")
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "")
        buffer = buffer.slice(newlineIdx + 1)

        if (!line || !line.startsWith("data: ")) {
          continue
        }

        const jsonStr = line.slice(6)
        try {
          const event = JSON.parse(jsonStr) as ExecStreamEvent
          yield event
        } catch {
          // Skip malformed events
        }
      }
    }

    // Handle any remaining buffered data line
    if (buffer.startsWith("data: ")) {
      try {
        const event = JSON.parse(buffer.slice(6)) as ExecStreamEvent
        yield event
      } catch {
        // Skip malformed events
      }
    }
  } finally {
    reader.releaseLock()
  }
}
