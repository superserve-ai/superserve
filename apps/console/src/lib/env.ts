function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function optional(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback
}

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_APP_URL: optional("NEXT_PUBLIC_APP_URL"),
  NEXT_PUBLIC_POSTHOG_KEY: optional("NEXT_PUBLIC_POSTHOG_KEY"),
  SANDBOX_API_URL: optional("SANDBOX_API_URL", "https://api.superserve.ai"),
} as const
