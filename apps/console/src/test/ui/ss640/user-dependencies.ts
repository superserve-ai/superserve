"use client"

// Only the Auth service boundary is substituted in this isolated runtime.
export function useUser() {
  return {
    user: { id: "00000000-0000-4000-8000-000000000640" },
    loading: false,
    error: null,
  }
}
