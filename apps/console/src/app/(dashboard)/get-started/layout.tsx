import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Get Started",
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
