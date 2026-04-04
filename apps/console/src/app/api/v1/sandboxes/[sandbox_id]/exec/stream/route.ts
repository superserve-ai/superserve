import { sandboxes } from "../../../../_mock/store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sandbox_id: string }> },
) {
  const { sandbox_id } = await params
  const sandbox = sandboxes.find(
    (s) => s.id === sandbox_id && s.status !== "deleted",
  )

  if (!sandbox) {
    return Response.json(
      { error: { code: "not_found", message: "Sandbox not found" } },
      { status: 404 },
    )
  }

  const body = await request.json()
  const { command } = body

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const chunks = [
        { stdout: `$ ${command}\n` },
        { stdout: "Running command...\n" },
        { stdout: `Hello from sandbox ${sandbox.name}!\n` },
        { stdout: "Done.\n", exit_code: 0, finished: true },
      ]

      for (const chunk of chunks) {
        const event = { timestamp: new Date().toISOString(), ...chunk }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
