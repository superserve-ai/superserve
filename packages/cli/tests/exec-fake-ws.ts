/**
 * A scripted stand-in for the global WebSocket. Each dial takes the next
 * behaviour from `script`; `server` sees every client frame and can answer.
 */
export interface FakeSocket {
  url: string
  protocols: string[]
  headers: Record<string, string>
  sent: (string | Uint8Array)[]
  /** Bytes the CLI wrote to process.stdout while this socket was live. */
  stdoutBytes: number[]
  receive(data: string | Uint8Array): void
  serverClose(code: number, reason?: string): void
}

type Server = (sock: FakeSocket, frame: string | Uint8Array) => void

export function installFakeWebSocket(
  script: ("open" | "fail")[],
  server: Server,
) {
  const sockets: FakeSocket[] = []
  const saved = globalThis.WebSocket

  class Fake {
    static OPEN = 1
    readyState = 0
    binaryType = "blob"
    bufferedAmount = 0
    onopen: ((ev: unknown) => void) | null = null
    onmessage: ((ev: { data: unknown }) => void) | null = null
    onclose: ((ev: { code: number; reason: string }) => void) | null = null
    onerror: ((ev: unknown) => void) | null = null
    sock: FakeSocket

    constructor(
      url: string,
      init: { protocols: string[]; headers: Record<string, string> },
    ) {
      // The harness swaps stdout.write per run; wrap it here to see raw bytes.
      const stdoutBytes: number[] = []
      const write = process.stdout.write
      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdoutBytes.push(
          ...(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        )
        return write.call(process.stdout, chunk)
      }) as typeof process.stdout.write
      this.sock = {
        url,
        protocols: init.protocols,
        headers: init.headers,
        sent: [],
        stdoutBytes,
        receive: (data) => {
          this.onmessage?.({
            data: typeof data === "string" ? data : data.slice().buffer,
          })
        },
        serverClose: (code, reason = "") => {
          if (this.readyState === 3) return
          this.readyState = 3
          this.onclose?.({ code, reason })
        },
      }
      sockets.push(this.sock)
      const behaviour = script.shift() ?? "fail"
      queueMicrotask(() => {
        if (behaviour === "fail") {
          this.readyState = 3
          this.onerror?.({})
          return
        }
        this.readyState = 1
        this.onopen?.({})
      })
    }

    send(data: string | Uint8Array) {
      const frame = typeof data === "string" ? data : new Uint8Array(data)
      this.sock.sent.push(frame)
      server(this.sock, frame)
    }

    close() {
      if (this.readyState === 3) return
      this.readyState = 3
      queueMicrotask(() => this.onclose?.({ code: 1000, reason: "" }))
    }
  }

  globalThis.WebSocket = Fake as unknown as typeof WebSocket
  return {
    sockets,
    restore: () => {
      globalThis.WebSocket = saved
    },
  }
}

export const textFrames = (sock: FakeSocket) =>
  sock.sent
    .filter((f): f is string => typeof f === "string")
    .map((f) => JSON.parse(f))
