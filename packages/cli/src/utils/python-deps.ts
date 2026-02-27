import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "./logger"
import { createSpinner } from "./spinner"

type PackageManager = "uv" | "poetry" | "pipenv" | "pip"

interface Detection {
  manager: PackageManager
  reason: string
}

function isBinaryAvailable(name: string): boolean {
  try {
    const result = Bun.spawnSync([name, "--version"])
    return result.exitCode === 0
  } catch {
    return false
  }
}

function detectPackageManager(projectDir: string): Detection | null {
  // 1. uv.lock exists → uv
  if (existsSync(join(projectDir, "uv.lock"))) {
    return { manager: "uv", reason: "uv.lock found" }
  }

  // 2. poetry.lock exists → poetry
  if (existsSync(join(projectDir, "poetry.lock"))) {
    return { manager: "poetry", reason: "poetry.lock found" }
  }

  // 3. pyproject.toml contains [tool.poetry] → poetry
  const pyprojectPath = join(projectDir, "pyproject.toml")
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, "utf-8")
    if (content.includes("[tool.poetry]")) {
      return {
        manager: "poetry",
        reason: "pyproject.toml contains [tool.poetry]",
      }
    }
  }

  // 4. Pipfile exists → pipenv
  if (existsSync(join(projectDir, "Pipfile"))) {
    return { manager: "pipenv", reason: "Pipfile found" }
  }

  // 5. pyproject.toml exists + uv binary on PATH → uv
  if (existsSync(pyprojectPath) && isBinaryAvailable("uv")) {
    return { manager: "uv", reason: "pyproject.toml found and uv available" }
  }

  // 6. requirements.txt exists → pip
  if (existsSync(join(projectDir, "requirements.txt"))) {
    return { manager: "pip", reason: "requirements.txt found" }
  }

  // 7. pyproject.toml / setup.py / setup.cfg exists → pip
  if (
    existsSync(pyprojectPath) ||
    existsSync(join(projectDir, "setup.py")) ||
    existsSync(join(projectDir, "setup.cfg"))
  ) {
    return { manager: "pip", reason: "Python project files found" }
  }

  // 8. Nothing found → skip
  return null
}

function getInstallCommand(manager: PackageManager): string[] {
  switch (manager) {
    case "uv":
      return ["uv", "add", "superserve"]
    case "pip":
      return ["pip", "install", "superserve"]
    case "pipenv":
      return ["pipenv", "install", "superserve"]
    case "poetry":
      return ["poetry", "add", "superserve"]
  }
}

export async function installPythonPackage(projectDir: string): Promise<void> {
  const detection = detectPackageManager(projectDir)
  if (!detection) return

  const { manager } = detection
  const command = getInstallCommand(manager)

  const spinner = createSpinner()
  spinner.start(`Installing superserve via ${manager}...`)

  try {
    const proc = Bun.spawn(command, {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    })
    const exitCode = await proc.exited

    if (exitCode === 0) {
      spinner.done()
      log.success(`Installed superserve via ${manager}`)
      if (manager === "pip") {
        log.hint(
          "Add 'superserve' to your requirements.txt to track the dependency",
        )
      }
    } else {
      spinner.fail()
      log.warning("Could not install superserve automatically")
      log.hint(`Run manually: ${command.join(" ")}`)
    }
  } catch {
    spinner.fail()
    log.warning("Could not install superserve automatically")
    log.hint(`Run manually: ${command.join(" ")}`)
  }
}
