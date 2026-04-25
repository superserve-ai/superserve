import { Sandbox, Template } from "@superserve/sdk"
import { describe, expect, it } from "vitest"
import { connectionOptions, hasCredentials, RUN_ID } from "../src/client.js"

describe.skipIf(!hasCredentials())("templates", () => {
  const opts = hasCredentials()
    ? connectionOptions()
    : { apiKey: "", baseUrl: "" }

  it("lists templates (includes system templates)", async () => {
    const list = await Template.list(opts)
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((t) => t.alias.startsWith("superserve/"))).toBe(true)
  })

  it(
    "creates a template, waits for ready, launches a sandbox from it, cleans up",
    async () => {
      const alias = `sdk-e2e-tpl-${RUN_ID}`
      const template = await Template.create({
        ...opts,
        alias,
        from: "python:3.11",
        steps: [{ run: "echo hello > /tmp/marker" }],
      })
      expect(template.alias).toBe(alias)

      try {
        await template.waitUntilReady({
          onLog: (ev) => {
            if (ev.stream === "stdout" || ev.stream === "stderr") {
              process.stdout.write(ev.text)
            }
          },
        })

        const fresh = await template.getInfo()
        expect(fresh.status).toBe("ready")

        const sandbox = await Sandbox.create({
          ...opts,
          name: `sdk-e2e-tpl-sbx-${RUN_ID}`,
          fromTemplate: template,
        })
        try {
          const result = await sandbox.commands.run("cat /tmp/marker")
          expect(result.stdout.trim()).toBe("hello")
        } finally {
          try {
            await sandbox.kill()
          } catch (err) {
            console.error(`Cleanup failed for sandbox ${sandbox.id}:`, err)
          }
        }
      } finally {
        try {
          await template.delete()
        } catch (err) {
          console.error(`Cleanup failed for template ${template.id}:`, err)
        }
      }
    },
    300_000,
  )
})
