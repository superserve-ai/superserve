import { AccountDeviceRecorder } from "@/components/account-device-recorder"

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <AccountDeviceRecorder />
      {children}
    </>
  )
}
