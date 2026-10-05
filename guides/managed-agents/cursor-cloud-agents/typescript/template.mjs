// The worker template: Ubuntu 24.04 with the Cursor CLI on PATH, git, and a
// /workspace directory. Shared by build-template.mjs and the e2e suite so the
// image under test is the image the guide ships.
import { createHash } from "node:crypto"

import { ConflictError, Template } from "@superserve/sdk"

export const TEMPLATE_NAME =
  process.env.CURSOR_WORKER_TEMPLATE || "cursor-worker"

export const TEMPLATE_SPEC = {
  from: "ubuntu:24.04",
  vcpu: 2,
  memoryMib: 2048,
  diskMib: 8192,
  steps: [
    {
      run:
        "apt-get update && apt-get install -y --no-install-recommends " +
        "ca-certificates curl git jq procps unzip && rm -rf /var/lib/apt/lists/*",
    },
    // Installs to /root/.local/bin/agent; the symlink puts it on every PATH.
    { run: "curl -fsS https://cursor.com/install | HOME=/root bash" },
    {
      run: "ln -sf /root/.local/bin/agent /usr/local/bin/agent && agent --version",
    },
    { run: "mkdir -p /workspace /var/lib/cursor-worker" },
    { workdir: "/workspace" },
  ],
}

// Short fingerprint of TEMPLATE_SPEC. The platform does not expose a
// template's build spec, so callers that must track spec changes (the e2e
// suite) put this in the template name and get a fresh build automatically.
export const TEMPLATE_SPEC_HASH = createHash("sha256")
  .update(JSON.stringify(TEMPLATE_SPEC))
  .digest("hex")
  .slice(0, 12)

// The CLI release the installer currently ships. The spec above installs
// whatever cursor.com/install serves today, so a build's contents depend on
// this as much as on the spec; callers that fingerprint the template (the
// e2e suite) fold it in so a Cursor release yields a fresh image.
export async function resolveCursorCliVersion({ timeoutMs = 30_000 } = {}) {
  const res = await fetch("https://cursor.com/install", {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`cursor.com/install returned ${res.status}`)
  const match = (await res.text()).match(/\/versions\/([0-9][A-Za-z0-9.-]*)/)
  if (!match) throw new Error("could not find a CLI version in the installer")
  return match[1]
}

// Template names are unique per team, so a rerun must pick up the existing
// template: reuse a ready one, wait on an in-flight build, rebuild a failed one.
// A ready template is reused as is: its spec is not readable back, so after
// changing TEMPLATE_SPEC delete the template (or pick a new name) to rebuild.
// Returns the ready Template.
export async function ensureTemplate({
  name = TEMPLATE_NAME,
  onLog,
  log = console.log,
} = {}) {
  const existing = (await Template.list()).find((t) => t.name === name)
  let template
  if (existing) {
    template = await Template.connect(existing.id)
    if (existing.status === "ready") {
      log(
        `template '${name}' already exists and is ready (id: ${existing.id}); ` +
          "delete it to rebuild after changing the spec",
      )
      return template
    }
    if (existing.status === "failed") {
      log(
        `template '${name}' has a failed build (id: ${existing.id}), rebuilding...`,
      )
      await template.rebuild()
      // Reconnect so waitUntilReady() tracks the new build, not the failed one.
      template = await Template.connect(existing.id)
    } else {
      log(
        `template '${name}' is ${existing.status} (id: ${existing.id}), waiting...`,
      )
    }
  } else {
    log(`creating template '${name}'...`)
    try {
      template = await Template.create({ name, ...TEMPLATE_SPEC })
      log(`template created (id: ${template.id}), waiting for build...`)
    } catch (e) {
      // Another builder (a second controller host, an overlapping test run)
      // created it between the lookup and here: track their build instead.
      if (!(e instanceof ConflictError)) throw e
      template = await Template.connect(name)
      log(
        `template '${name}' was just created elsewhere (id: ${template.id}), waiting for its build...`,
      )
    }
  }
  await template.waitUntilReady({ onLog })
  log(`template '${name}' is ready (id: ${template.id})`)
  return template
}
