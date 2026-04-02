import type { Metadata } from "next"
import { GetStartedStep } from "@/components/get-started/get-started-step"

export const metadata: Metadata = {
  title: "Get Started",
}

const STEPS = [
  {
    title: "Install Superserve CLI",
    description:
      "Run the following command in your terminal to install Superserve CLI",
    command: "curl -sL https://superserve.ai/install | sh",
  },
  {
    title: "Login to your account",
    description: "Login to Superserve CLI with device code through the console",
    command: "superserve login",
  },
  {
    title: "Create a sandbox",
    description: "Create your first sandbox to get started",
    command: "superserve create my-sandbox",
  },
  {
    title: "Run sandbox",
    description: "Run your sandbox through the terminal",
    command: "superserve run my-sandbox",
  },
]

export default function GetStartedPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-[28px] font-medium leading-none tracking-tight text-foreground mt-12">
        Get Started
      </h1>
      <p className="mt-3 text-sm leading-none tracking-tight text-muted">
        Install CLI and create your first sandbox
      </p>

      <div className="mt-10 space-y-10">
        {STEPS.map((step, i) => (
          <GetStartedStep
            key={step.title}
            stepNumber={i + 1}
            title={step.title}
            description={step.description}
            command={step.command}
          />
        ))}
      </div>
    </div>
  )
}
