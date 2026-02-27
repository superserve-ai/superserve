/**
 * Progress bar and tracking utilities for better UX
 */

interface ProgressOptions {
  total: number
  width?: number
  showPercentage?: boolean
  showETA?: boolean
}

export class ProgressBar {
  private current = 0
  private total: number
  private width: number
  private showPercentage: boolean
  private showETA: boolean
  private startTime = Date.now()

  constructor(options: ProgressOptions) {
    this.total = options.total
    this.width = options.width ?? 30
    this.showPercentage = options.showPercentage ?? true
    this.showETA = options.showETA ?? true
  }

  update(current: number): void {
    this.current = Math.min(current, this.total)
    this.render()
  }

  increment(amount = 1): void {
    this.update(this.current + amount)
  }

  finish(): void {
    this.current = this.total
    this.render()
    console.log()
  }

  private render(): void {
    const percentage = this.total > 0 ? this.current / this.total : 0
    const filled = Math.round(percentage * this.width)
    const empty = this.width - filled

    let bar = `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}]`

    if (this.showPercentage) {
      const pct = Math.round(percentage * 100)
      bar += ` ${pct}%`
    }

    if (this.showETA && this.current > 0 && this.current < this.total) {
      const elapsed = Date.now() - this.startTime
      const rate = this.current / elapsed
      const remaining = (this.total - this.current) / rate
      const eta = Math.round(remaining / 1000)
      bar += ` ETA: ${this.formatSeconds(eta)}`
    }

    process.stderr.write(`\r${bar}`)
  }

  private formatSeconds(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}m ${secs}s`
  }
}

/**
 * Multi-step progress tracker
 */
export class StepProgress {
  private steps: Map<string, "pending" | "in-progress" | "completed" | "failed"> =
    new Map()
  private currentStep: string | null = null

  constructor(stepNames: string[]) {
    for (const name of stepNames) {
      this.steps.set(name, "pending")
    }
  }

  start(stepName: string): void {
    if (!this.steps.has(stepName)) {
      throw new Error(`Unknown step: ${stepName}`)
    }
    this.currentStep = stepName
    this.steps.set(stepName, "in-progress")
    this.render()
  }

  complete(stepName: string): void {
    if (!this.steps.has(stepName)) {
      throw new Error(`Unknown step: ${stepName}`)
    }
    this.steps.set(stepName, "completed")
    if (this.currentStep === stepName) {
      this.currentStep = null
    }
    this.render()
  }

  fail(stepName: string): void {
    if (!this.steps.has(stepName)) {
      throw new Error(`Unknown step: ${stepName}`)
    }
    this.steps.set(stepName, "failed")
    if (this.currentStep === stepName) {
      this.currentStep = null
    }
    this.render()
  }

  private render(): void {
    console.clear?.()
    for (const [name, status] of this.steps.entries()) {
      let symbol = " "
      switch (status) {
        case "completed":
          symbol = "\u2713" // ✓
          break
        case "in-progress":
          symbol = "\u25cf" // ●
          break
        case "failed":
          symbol = "\u2717" // ✗
          break
        case "pending":
          symbol = "\u25cb" // ○
          break
      }

      const color =
        status === "completed"
          ? "\x1b[32m"
          : status === "failed"
            ? "\x1b[31m"
            : status === "in-progress"
              ? "\x1b[33m"
              : "\x1b[0m"
      const reset = "\x1b[0m"

      console.log(`${color}${symbol}${reset} ${name}`)
    }
    console.log()
  }
}

/**
 * Simple loading indicator
 */
export class LoadingIndicator {
  private frames = ["\u25CF ", "\u25CB "]
  private currentFrame = 0
  private timer: NodeJS.Timeout | null = null

  start(message: string): void {
    if (this.timer) return

    this.timer = setInterval(() => {
      const frame = this.frames[this.currentFrame % this.frames.length]
      process.stderr.write(`\r${frame}${message}`)
      this.currentFrame++
    }, 200)
  }

  stop(finalMessage?: string): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (finalMessage) {
      process.stderr.write(`\r\u2713 ${finalMessage}\n`)
    } else {
      process.stderr.write("\r")
    }
  }
}
