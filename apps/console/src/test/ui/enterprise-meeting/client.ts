export function createBrowserClient() {
  return { auth: { signOut: async () => ({ error: null }) } }
}
