import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { parseYCConfirmation, ycRequest, YC_COOKIE } from "@/lib/yc-claims"
import { ycBrowserOrigin } from "@/lib/yc/browser-origin"

export const dynamic = "force-dynamic"

// A route response deliberately avoids the app's analytics and session recorder.
// Tokens arrive in a fragment, never a request URL, and GET does not consume them.
export async function GET() {
  const nonce = randomBytes(18).toString("base64")
  // Native form POSTs send Origin: null under no-referrer. Keep same-origin
  // provenance while withholding referrers from other origins.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Confirm your YC email</title><style nonce="${nonce}">body{margin:0;background:#faf9f6;color:#242421;font-family:system-ui,sans-serif;line-height:1.6}main{max-width:34rem;margin:12vh auto;padding:2rem}h1{font-size:2rem;letter-spacing:-.04em;line-height:1.2}button{font:inherit;background:#242421;color:white;border:0;border-radius:.4rem;padding:.8rem 1.2rem;cursor:pointer}button:disabled{opacity:.5;cursor:default}#error{color:#9d271d}</style></head><body><main><h1>Confirm your email</h1><p>Confirm that this is the email address you want to use for your Superserve YC claim. Then sign up or sign in using that address.</p><form method="post" action="/yc/confirm/"><input type="hidden" name="id"><input type="hidden" name="token"><button disabled>Confirm email and continue</button></form><p id="error" role="alert"></p></main><script nonce="${nonce}">const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'','/yc/confirm/');const id=p.get('claim')||'',token=p.get('token')||'';if(/^[a-f0-9-]{36}$/i.test(id)&&/^[A-Za-z0-9_-]{43}$/.test(token)){document.querySelector('[name=id]').value=id;document.querySelector('[name=token]').value=token;document.querySelector('button').disabled=false}else{document.getElementById('error').textContent='This link is incomplete. Open the full link from your confirmation email.'}</script></body></html>`
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function POST(request: Request) {
  // Next's request URL may use the internal listener behind a reverse proxy.
  // Only deployment configuration determines the browser-facing origin.
  const origin = ycBrowserOrigin(process.env.NEXT_PUBLIC_APP_URL)
  if (!origin || request.headers.get("origin") !== origin)
    return new Response("Invalid confirmation origin.", { status: 403 })
  const reader = request.body?.getReader()
  if (!reader) return new Response("Invalid confirmation.", { status: 400 })
  let text = ""
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (text.length > 2048) {
      await reader.cancel()
      return new Response("Invalid confirmation.", { status: 413 })
    }
  }
  const form = new URLSearchParams(text)
  const proof = parseYCConfirmation(`${form.get("id")}.${form.get("token")}`)
  if (!proof) return new Response("Invalid confirmation.", { status: 400 })
  try {
    await ycRequest("confirm", proof)
    const response = NextResponse.redirect(new URL("/yc/claim", origin), 303)
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    response.cookies.set(YC_COOKIE, `${proof.id}.${proof.token}`, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    })
    return response
  } catch {
    return new Response(
      "Confirmation could not be completed. The link may have expired, or the service may be unavailable. Retry or contact Superserve for review.",
      { status: 409, headers: { "Cache-Control": "no-store" } },
    )
  }
}
