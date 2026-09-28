import { ToastProvider } from "@superserve/ui"

import { QueryProvider } from "@/components/query-provider"

import "../../../src/app/globals.css"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <QueryProvider>{children}</QueryProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
