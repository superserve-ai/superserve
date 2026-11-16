import { Geist_Mono, Instrument_Sans } from "next/font/google"
import type { ReactNode } from "react"

import "./globals.css"

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--sans-font" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--mono-font" })

export const metadata = { icons: { icon: "data:," } }

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
