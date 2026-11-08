export const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

type Grecaptcha = {
  enterprise: {
    ready: (callback: () => void) => void
    execute: (siteKey: string, options: { action: string }) => Promise<string>
  }
}

const getGrecaptcha = () =>
  (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha

const LOAD_TIMEOUT_MS = 8000
const EXECUTE_TIMEOUT_MS = 8000

/**
 * Returns a reCAPTCHA Enterprise token for `action`, or undefined when no site
 * key is configured or the script did not load or answer in time. The page
 * must load `enterprise.js?render=<site key>`.
 */
export const getRecaptchaToken = async (
  action: string,
): Promise<string | undefined> => {
  const siteKey = RECAPTCHA_SITE_KEY
  if (!siteKey) return undefined
  const start = Date.now()
  while (!getGrecaptcha()) {
    if (Date.now() - start >= LOAD_TIMEOUT_MS) return undefined
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const grecaptcha = getGrecaptcha()!
  try {
    const tokenPromise = new Promise<string>((resolve, reject) => {
      grecaptcha.enterprise.ready(() => {
        grecaptcha.enterprise
          .execute(siteKey, { action })
          .then(resolve)
          .catch(reject)
      })
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("recaptcha_execute_timeout")),
        EXECUTE_TIMEOUT_MS,
      ),
    )
    return await Promise.race([tokenPromise, timeoutPromise])
  } catch {
    return undefined
  }
}
