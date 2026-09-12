import { QmGate } from "@/components/qm/qm-gate"

export default function QmLayout({ children }: { children: React.ReactNode }) {
  return <QmGate>{children}</QmGate>
}
