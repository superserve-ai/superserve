import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const directory = process.argv[2] ?? "/var/tmp/team-invite-screenshots"
await mkdir(directory, { recursive: true })
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=/var/tmp/chrome-fixture",
    "--remote-debugging-port=9227",
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
)
let socket
try {
  let endpoint
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const tabs = await (await fetch("http://127.0.0.1:9227/json/list")).json()
      endpoint = tabs.find((tab) => tab.type === "page")?.webSocketDebuggerUrl
      if (endpoint) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(endpoint, "Chrome must start")
  socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let sequence = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request?.reject(message.error)
      else request?.resolve(message.result)
    }
    if (
      message.method === "Log.entryAdded" &&
      message.params.entry.level === "error"
    )
      errors.push(
        message.params.entry.text + " " + (message.params.entry.url ?? ""),
      )
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.text +
          ": " +
          message.params.exceptionDetails.exception?.description,
      )
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      errors.push(JSON.stringify(message.params.args))
  }
  function call(method, params = {}) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  await call("Runtime.enable")
  await call("Log.enable")
  await call("Page.enable")
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const expected = {
    page: "Pending invitations",
    modal: "Invalid email",
    results: "Invite created, email failed",
    legacy: "Invites join as Owner with full access to this team.",
  }
  for (const [scenario, text] of Object.entries(expected)) {
    errors.length = 0
    const url = `http://127.0.0.1:4177/?scenario=${scenario}`
    assert.equal((await fetch(url)).status, 200)
    await call("Page.navigate", { url })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const result = await call("Runtime.evaluate", {
      expression: `(async () => {
        const deadline = Date.now() + 8000;
        while (!document.body.innerText.includes(${JSON.stringify(text)})) {
          if (Date.now() > deadline) throw new Error(document.body.innerText);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await document.fonts.ready;
        return { text: document.body.innerText, roles: Array.from(document.querySelectorAll('select[aria-label^="Role for"]'), select => ({ value: select.value, label: select.selectedOptions[0].textContent })), mono: getComputedStyle(document.querySelector('button')).fontFamily };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    assert.deepEqual(errors, [], `${scenario} browser errors`)
    assert.ok(
      result.result.value.mono.includes("Geist Mono"),
      `${scenario} uses Geist Mono buttons`,
    )
    if (scenario === "legacy") assert.deepEqual(result.result.value.roles, [])
    if (scenario === "modal") {
      assert.deepEqual(
        result.result.value.roles,
        Array.from({ length: 4 }, () => ({
          value: "team_admin",
          label: "Team admin",
        })),
      )
    }
    if (scenario === "results") {
      assert.deepEqual(result.result.value.roles, [
        { value: "team_admin", label: "Team admin" },
        { value: "viewer", label: "Viewer" },
        { value: "billing_admin", label: "Billing admin" },
        { value: "user_admin", label: "User admin" },
      ])
      assert.ok(result.result.value.text.includes("Already a member"))
      assert.ok(result.result.value.text.includes("Already invited"))
      assert.ok(result.result.value.text.includes("Sent"))
    }
    const screenshot = await call("Page.captureScreenshot", { format: "png" })
    const path = join(directory, `team-invite-${scenario}.png`)
    await writeFile(path, Buffer.from(screenshot.data, "base64"))
    console.log(
      `${scenario}: HTTP 200, expected UI, no browser errors; ${path}`,
    )
  }
} finally {
  socket?.close()
  chrome.kill("SIGTERM")
  await new Promise((resolve) => chrome.once("exit", resolve))
}
