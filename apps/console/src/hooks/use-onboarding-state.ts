"use client"

import { useCallback, useState, useEffect } from "react"

export type OnboardingStep = 1 | 2 | 3
export type AgentPath = "own" | "example" | null
export type Framework =
  | "agno"
  | "claude-agent-sdk"
  | "langchain"
  | "mastra"
  | "openai-agents-sdk"
  | "pydantic-ai"
  | null

interface OnboardingState {
  currentStep: OnboardingStep
  completedSteps: Set<OnboardingStep>
  agentPath: AgentPath
  framework: Framework
  expandedStep: OnboardingStep | null
}

const STORAGE_KEY = "superserve-onboarding"

function loadState(): OnboardingState {
  if (typeof window === "undefined") return defaultState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    return {
      ...defaultState(),
      ...parsed,
      completedSteps: new Set(parsed.completedSteps ?? []),
    }
  } catch {
    return defaultState()
  }
}

function defaultState(): OnboardingState {
  return {
    currentStep: 1,
    completedSteps: new Set(),
    agentPath: null,
    framework: null,
    expandedStep: 1,
  }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        completedSteps: Array.from(state.completedSteps),
      }),
    )
  } catch {}
}

export function useOnboardingState() {
  const [state, setState] = useState<OnboardingState>(defaultState)

  useEffect(() => {
    setState(loadState())
  }, [])

  const update = useCallback((updater: (prev: OnboardingState) => OnboardingState) => {
    setState((prev) => {
      const next = updater(prev)
      saveState(next)
      return next
    })
  }, [])

  const completeStep = useCallback(
    (step: OnboardingStep) => {
      update((prev) => {
        const next = { ...prev, completedSteps: new Set(prev.completedSteps) }
        next.completedSteps.add(step)
        if (step < 3) {
          next.currentStep = (step + 1) as OnboardingStep
          next.expandedStep = (step + 1) as OnboardingStep
        } else {
          next.expandedStep = step
        }
        return next
      })
    },
    [update],
  )

  const toggleStep = useCallback(
    (step: OnboardingStep) => {
      update((prev) => ({
        ...prev,
        expandedStep: prev.expandedStep === step ? null : step,
      }))
    },
    [update],
  )

  const setAgentPath = useCallback(
    (path: AgentPath) => {
      update((prev) => ({
        ...prev,
        agentPath: path,
        framework: path === null ? null : prev.framework,
      }))
    },
    [update],
  )

  const setFramework = useCallback(
    (fw: Framework) => {
      update((prev) => ({ ...prev, framework: fw }))
    },
    [update],
  )

  return {
    ...state,
    isStepCompleted: (step: OnboardingStep) => state.completedSteps.has(step),
    completeStep,
    toggleStep,
    setAgentPath,
    setFramework,
  }
}
