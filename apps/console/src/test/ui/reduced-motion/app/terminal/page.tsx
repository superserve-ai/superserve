"use client"

import { SandboxTerminal } from "@/components/sandboxes/terminal"

import { FixtureShell } from "../fixture-shell"

const PROMPT = "\x1b[32muser@sbx-7f3a91c2\x1b[0m:\x1b[34m~\x1b[0m$ "

// Stands in for the sandbox terminal socket: it opens at once and sends a
// prompt, so the real SandboxTerminal focuses itself and shows its cursor.
class FakeSocket {
  static readonly OPEN = 1
  readyState = 0
  binaryType = "arraybuffer"
  onopen: (() => void) | null = null
  onmessage: ((evt: { data: ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((evt: { code: number; reason: string }) => void) | null = null
  constructor() {
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN
      this.onopen?.()
      const bytes = new TextEncoder().encode(
        `Welcome to the fixture shell\r\n${PROMPT}`,
      )
      this.onmessage?.({ data: bytes.buffer as ArrayBuffer })
    }, 50)
  }
  send() {}
  close() {
    this.readyState = 3
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "WebSocket", {
    value: FakeSocket,
    configurable: true,
  })
}

export default function Page() {
  return (
    <FixtureShell>
      <div className="h-[420px] p-4" data-testid="terminal-host">
        <SandboxTerminal sandboxId="sbx-7f3a91c2" accessToken="fixture-token" />
      </div>
    </FixtureShell>
  )
}
