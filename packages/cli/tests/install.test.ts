import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const INSTALL_SH = join(import.meta.dir, "..", "install.sh")

// Runs the real install.sh offline: fake curl serves a stub binary that logs
// its calls, and fake uname picks the OS. Without a terminal, no login starts.
function install(env: Record<string, string>, os = "Darwin") {
  const home = env.HOME
  const fakes = join(home, ".fakes")
  mkdirSync(fakes, { recursive: true })
  writeFileSync(
    join(fakes, "stub"),
    `#!/bin/sh\necho "$*" >> "${fakes}/calls"\nexit 0\n`,
  )
  writeFileSync(
    join(fakes, "uname"),
    `#!/bin/sh\n[ "$1" = "-m" ] && echo arm64 || echo ${os}\n`,
  )
  writeFileSync(
    join(fakes, "curl"),
    `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
done
stub="${fakes}/stub"
case "$url" in
  *api.github.com*) echo '[{"tag_name": "cli-v9.9.9"}]' ;;
  */SHA256SUMS)
    sum=$( (sha256sum "$stub" 2>/dev/null || shasum -a 256 "$stub") | cut -d' ' -f1)
    for b in darwin-arm64 linux-arm64; do echo "$sum  superserve-bun-$b"; done > "$out" ;;
  *) cp "$stub" "$out" ;;
esac
`,
  )
  for (const f of ["uname", "curl"]) chmodSync(join(fakes, f), 0o755)
  const { PATH_PREFIX, ...rest } = env
  const r = spawnSync("sh", [INSTALL_SH], {
    env: {
      PATH: [PATH_PREFIX, fakes, "/usr/bin", "/bin"].filter(Boolean).join(":"),
      ...rest,
    },
    encoding: "utf8",
  })
  expect(r.status).toBe(0)
  return r.stdout
}

function newHome() {
  return mkdtempSync(join(tmpdir(), "superserve-install-"))
}

describe("install.sh PATH setup", () => {
  test.each([".profile", ".bash_login"])(
    "macOS Bash appends to an existing %s instead of shadowing it",
    (file) => {
      const home = newHome()
      writeFileSync(join(home, file), "export KEEP=1\n")
      install({ HOME: home, SHELL: "/bin/bash" })
      expect(existsSync(join(home, ".bash_profile"))).toBe(false)
      const profile = readFileSync(join(home, file), "utf8")
      expect(profile).toContain("export KEEP=1")
      expect(profile).toContain(".superserve/bin")
      // Non-login terminals read .bashrc instead.
      expect(readFileSync(join(home, ".bashrc"), "utf8")).toContain(
        ".superserve/bin",
      )
    },
  )

  test("Linux Bash also updates an existing login file, for SSH sessions", () => {
    const home = newHome()
    writeFileSync(join(home, ".profile"), "export KEEP=1\n")
    install({ HOME: home, SHELL: "/bin/bash" }, "Linux")
    for (const file of [".bashrc", ".profile"])
      expect(readFileSync(join(home, file), "utf8")).toContain(
        ".superserve/bin",
      )
    expect(existsSync(join(home, ".bash_profile"))).toBe(false)
  })

  test("Linux Bash with no login file creates .profile", () => {
    const home = newHome()
    install({ HOME: home, SHELL: "/bin/bash" }, "Linux")
    expect(readFileSync(join(home, ".profile"), "utf8")).toContain(
      ".superserve/bin",
    )
  })

  test("doesn't call the API when it won't sign in", () => {
    const home = newHome()
    install({ HOME: home, SHELL: "/bin/zsh" })
    expect(existsSync(join(home, ".fakes", "calls"))).toBe(false)
  })

  test.skipIf(!Bun.which("zsh"))(
    "zsh follows a ZDOTDIR that only .zshenv sets",
    () => {
      const home = newHome()
      writeFileSync(
        join(home, ".zshenv"),
        `echo "hello from zshenv"\nZDOTDIR="$HOME/zdot"\n`,
      )
      install({ HOME: home, SHELL: "/bin/zsh" })
      expect(readFileSync(join(home, "zdot", ".zshrc"), "utf8")).toContain(
        ".superserve/bin",
      )
    },
  )

  test("the manual PATH hint survives copying for an awkward dir", () => {
    const home = newHome()
    const dir = join(home, "it's a $dir")
    const out = install({
      HOME: home,
      SHELL: "/bin/zsh",
      SUPERSERVE_INSTALL_DIR: dir,
      SUPERSERVE_NO_MODIFY_PATH: "1",
    })
    const hint = out.split("\n").find((l) => l.includes("export PATH="))
    const found = spawnSync("sh", ["-c", `${hint}; command -v superserve`], {
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    })
    expect(found.stdout.trim()).toBe(join(dir, "superserve"))
  })

  test("persists PATH even when the installer's PATH already has the dir", () => {
    const home = newHome()
    const out = install({
      HOME: home,
      SHELL: "/bin/zsh",
      PATH_PREFIX: `${home}/.superserve/bin`,
    })
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toContain(
      ".superserve/bin",
    )
    expect(out).not.toContain("Open a new terminal")
  })

  test("warns when an older superserve comes first on PATH", () => {
    const home = newHome()
    const old = join(home, "old-bin")
    mkdirSync(old)
    writeFileSync(join(old, "superserve"), "#!/bin/sh\n")
    chmodSync(join(old, "superserve"), 0o755)
    const out = install({ HOME: home, SHELL: "/bin/zsh", PATH_PREFIX: old })
    expect(out).toContain(`another superserve at ${old}/superserve`)
  })

  test("Fish gets fish syntax in the manual PATH hint", () => {
    const home = newHome()
    const out = install({
      HOME: home,
      SHELL: "/usr/bin/fish",
      SUPERSERVE_NO_MODIFY_PATH: "1",
    })
    expect(out).toContain(`fish_add_path '${home}/.superserve/bin'`)
    expect(out).not.toContain("export PATH=")
  })

  test("Fish writes to the config under XDG_CONFIG_HOME", () => {
    const home = newHome()
    const xdg = join(home, "xdg")
    install({ HOME: home, SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: xdg })
    expect(readFileSync(join(xdg, "fish", "config.fish"), "utf8")).toContain(
      `fish_add_path '${home}/.superserve/bin'`,
    )
    expect(existsSync(join(home, ".config"))).toBe(false)
  })

  test("an install dir with spaces, quotes and $ survives the profile", () => {
    const home = newHome()
    const dir = join(home, "it's a $dir `x`")
    install({ HOME: home, SHELL: "/bin/zsh", SUPERSERVE_INSTALL_DIR: dir })
    const found = spawnSync(
      "sh",
      ["-c", '. "$HOME/.zshrc"; command -v superserve'],
      { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" },
    )
    expect(found.stdout.trim()).toBe(join(dir, "superserve"))
  })

  test("re-running adds the line once; a commented-out copy doesn't count", () => {
    const home = newHome()
    const line = `export PATH='${home}/.superserve/bin':"$PATH"`
    writeFileSync(join(home, ".zshrc"), `# ${line}\n`)
    install({ HOME: home, SHELL: "/bin/zsh" })
    install({ HOME: home, SHELL: "/bin/zsh" })
    const active = readFileSync(join(home, ".zshrc"), "utf8")
      .split("\n")
      .filter((l) => l === line)
    expect(active).toHaveLength(1)
  })
})
