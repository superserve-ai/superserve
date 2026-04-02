import type { Metadata } from "next"
import { GetStartedStep } from "@/components/get-started/get-started-step"
import { PageHeader } from "@/components/page-header"

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
    <div className="flex h-full flex-col">
      <PageHeader title="Get Started" />

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm leading-none tracking-tight text-muted">
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
      </div>
    </div>
  )
}
