"use client"

// Fixture replacements for the query hooks CreateSandboxDialog reads, so the
// dialog renders without the sandbox API or Supabase. See next.config.ts.
const empty = { data: [], isLoading: false, isError: false, error: null }

export function useTemplates() {
  return empty
}

export function useSnapshots(_options?: { enabled?: boolean }) {
  return empty
}

export function useSecrets() {
  return empty
}
