/**
 * Generic SSE parser. Yields raw {data} objects parsed from SSE `data:` lines.
 * Works in all JS runtimes (Node, Browser, Edge workers).
 * @internal
 */
export async function* parseSSEStream<T = unknown>(
  response: Response,
): AsyncGenerator<T> {
  if (!response.body) return

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

        try {
          yield JSON.parse(line.slice(6)) as T
        } catch {
          // Skip malformed events
        }
      }
    }

    // Handle remaining buffer
    if (buffer.startsWith("data: ")) {
      try {
        yield JSON.parse(buffer.slice(6)) as T
      } catch {
        // Skip malformed
      }
    }
  } finally {
    reader.releaseLock()
  }
}
