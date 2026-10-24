export function FailureNotice({
  message,
  detail,
}: {
  message: string
  detail?: string
}) {
  return (
    <>
      <span className="block">{message}</span>
      {detail ? <span className="mt-1 block">Reason: {detail}</span> : null}
    </>
  )
}
