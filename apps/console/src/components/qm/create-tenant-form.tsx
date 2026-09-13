"use client"

import { CaretDownIcon, CheckIcon, XIcon } from "@phosphor-icons/react"
import {
  Button,
  cn,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Spinner,
  useToast,
} from "@superserve/ui"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useRouter } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { useEffect, useId, useRef, useState } from "react"

import { CornerBrackets } from "@/components/corner-brackets"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  useCreateQmTenant,
  useQmSlugAvailability,
} from "@/hooks/use-qm-tenants"
import { ApiError } from "@/lib/api/client"
import { qmKeys } from "@/lib/api/query-keys"
import type { QmHarness, QmModelProvider, QmSignIn } from "@/lib/api/types"
import { QM_EVENTS } from "@/lib/posthog/events"
import { adminEmailError } from "@/lib/qm/email"
import {
  DEFAULT_HARNESS,
  HARNESS_LABEL,
  HARNESS_OPTIONS,
  harnessAllowed,
  PROVIDER_LABEL,
  PROVIDER_OPTIONS,
  SIGN_IN_LABEL,
  SIGN_IN_OPTIONS,
} from "@/lib/qm/options"
import { sanitizeSlugInput, slugError, slugify, tenantUrl } from "@/lib/qm/slug"

const SLUG_DEBOUNCE_MS = 400

type FieldName = "orgName" | "slug" | "adminEmail" | "modelKey"

/** Server field names map 1:1 onto the request body; anything else is shown near the submit button. */
const FORM_FIELDS: ReadonlySet<string> = new Set([
  "orgName",
  "slug",
  "adminEmail",
  "modelKey",
  "signIn",
  "modelProvider",
  "harness",
])

interface CreateTenantFormProps {
  /** Signed-in user's email; pre-fills the admin address until edited. */
  defaultAdminEmail?: string | null
}

export function CreateTenantForm({ defaultAdminEmail }: CreateTenantFormProps) {
  const router = useRouter()
  const posthog = usePostHog()
  const { addToast } = useToast()
  const create = useCreateQmTenant()
  const queryClient = useQueryClient()
  const idPrefix = useId()

  const [orgName, setOrgName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [adminEmail, setAdminEmail] = useState(defaultAdminEmail ?? "")
  const [emailTouched, setEmailTouched] = useState(false)
  const [signIn, setSignIn] = useState<QmSignIn>("magic_link")
  const [provider, setProvider] = useState<QmModelProvider>("anthropic")
  const [harness, setHarness] = useState<QmHarness>(DEFAULT_HARNESS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // The provider key lives only in the (uncontrolled) input's DOM value; we
  // track whether one has been entered so validation can re-render without
  // the key ever passing through React state.
  const keyRef = useRef<HTMLInputElement>(null)
  const [hasKey, setHasKey] = useState(false)

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>(
    {},
  )
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Belt and braces with the disabled button: a second click during the
  // same tick (before React re-renders) must not fire a second request.
  const submittingRef = useRef(false)

  // Adopt the signed-in user's email once it loads, unless already edited.
  useEffect(() => {
    if (defaultAdminEmail && !emailTouched) setAdminEmail(defaultAdminEmail)
  }, [defaultAdminEmail, emailTouched])

  // --- Slug availability ---------------------------------------------------
  const clientSlugError = slugError(slug)
  const debouncedSlug = useDebouncedValue(slug, SLUG_DEBOUNCE_MS)
  const availability = useQmSlugAvailability(
    slugError(debouncedSlug) ? "" : debouncedSlug,
  )
  const slugSettled = debouncedSlug === slug && !availability.isFetching
  const slugTaken =
    slugSettled && availability.data ? !availability.data.available : false

  // --- Validation ----------------------------------------------------------
  const clientErrors: Partial<Record<FieldName, string>> = {}
  if (!orgName.trim()) clientErrors.orgName = "Enter your organization's name."
  if (clientSlugError) clientErrors.slug = clientSlugError
  else if (slugTaken)
    clientErrors.slug = availability.data?.reason ?? "That subdomain is taken."
  const emailError = adminEmailError(adminEmail)
  if (emailError) clientErrors.adminEmail = emailError
  if (!hasKey) clientErrors.modelKey = "Enter your provider API key."

  const fieldError = (name: FieldName): string | undefined =>
    serverErrors[name] ?? (touched[name] ? clientErrors[name] : undefined)

  const clearServerError = (name: string) => {
    if (!(name in serverErrors)) return
    setServerErrors(({ [name]: _removed, ...rest }) => rest)
  }

  const otherServerErrors = Object.entries(serverErrors).filter(
    ([name]) => !FORM_FIELDS.has(name),
  )

  // --- Handlers ------------------------------------------------------------
  const handleOrgName = (value: string) => {
    setOrgName(value)
    clearServerError("orgName")
    if (!slugTouched) {
      setSlug(slugify(value))
      clearServerError("slug")
    }
  }

  const handleSlug = (value: string) => {
    setSlugTouched(true)
    setSlug(sanitizeSlugInput(value))
    clearServerError("slug")
  }

  const handleProvider = (value: QmModelProvider) => {
    setProvider(value)
    clearServerError("modelProvider")
    if (!harnessAllowed(harness, value)) setHarness(DEFAULT_HARNESS)
  }

  const canSubmit =
    Object.keys(clientErrors).length === 0 && slugSettled && !create.isPending

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched({ orgName: true, slug: true, adminEmail: true, modelKey: true })
    setSubmitError(null)
    if (!canSubmit || submittingRef.current) return
    const modelKey = keyRef.current?.value.trim() ?? ""
    if (!modelKey) return

    submittingRef.current = true
    posthog.capture(QM_EVENTS.STACK_CREATE_SUBMITTED, {
      sign_in: signIn,
      model_provider: provider,
      harness,
    })
    create.mutate(
      {
        slug,
        orgName: orgName.trim(),
        adminEmail: adminEmail.trim(),
        signIn,
        modelProvider: provider,
        modelKey,
        harness,
      },
      {
        onSuccess: (tenant) => {
          if (keyRef.current) keyRef.current.value = ""
          posthog.capture(QM_EVENTS.STACK_CREATED, { tenant_id: tenant.id })
          addToast("Creating your QM stack", "success")
          router.replace(`/qm/${tenant.id}`)
        },
        onError: (error) => {
          posthog.capture(QM_EVENTS.STACK_CREATE_FAILED, {
            status: error instanceof ApiError ? error.status : null,
          })
          // Mirrors the hook: only a 400 with field messages is inline.
          if (
            error instanceof ApiError &&
            error.status === 400 &&
            error.fields &&
            Object.keys(error.fields).length > 0
          ) {
            setServerErrors(error.fields)
            return
          }
          if (error instanceof ApiError && error.status === 409) {
            setSubmitError(error.message)
          }
          // Everything else was already toasted by the hook. Any of these
          // may have left a tenant behind (a 409 because one exists, or a
          // 5xx after the row was inserted but before its key or run was
          // recorded), so refresh the list: the page redirects to whatever
          // tenant now exists rather than letting the form be resubmitted.
          queryClient.invalidateQueries({ queryKey: qmKeys.lists() })
        },
        onSettled: () => {
          submittingRef.current = false
        },
      },
    )
  }

  const url = tenantUrl(slug || "your-org")
  const providerOption = PROVIDER_OPTIONS.find((o) => o.value === provider)

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6"
    >
      {/* 01 · Organization */}
      <FormSection index="01" title="Organization">
        <Field label="Organization name" htmlFor={`${idPrefix}-org`} required>
          <Input
            id={`${idPrefix}-org`}
            error={fieldError("orgName")}
            value={orgName}
            onChange={(e) => handleOrgName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, orgName: true }))}
            placeholder="Acme"
            autoComplete="organization"
          />
        </Field>

        <Field label="Subdomain" htmlFor={`${idPrefix}-slug`} required>
          <Input
            id={`${idPrefix}-slug`}
            error={fieldError("slug")}
            value={slug}
            onChange={(e) => handleSlug(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, slug: true }))}
            placeholder="acme"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            suffix={
              <SlugStatus
                slug={slug}
                settled={slugSettled}
                taken={slugTaken}
                valid={!clientSlugError}
                available={availability.data?.available}
              />
            }
          />
          <p className="font-mono text-xs break-all text-muted">
            <span className="text-foreground/80">{url}</span>
          </p>
        </Field>
      </FormSection>

      {/* 02 · Admin */}
      <FormSection index="02" title="Admin">
        <Field
          label="Admin email"
          htmlFor={`${idPrefix}-email`}
          description="Becomes the stack's first admin and receives its sign-in email. Use a work address."
          required
        >
          <Input
            id={`${idPrefix}-email`}
            error={fieldError("adminEmail")}
            type="email"
            value={adminEmail}
            onChange={(e) => {
              setEmailTouched(true)
              setAdminEmail(e.target.value)
              clearServerError("adminEmail")
            }}
            onBlur={() => setTouched((t) => ({ ...t, adminEmail: true }))}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
      </FormSection>

      {/* 03 · Sign-in */}
      <FormSection index="03" title="Sign-in">
        <RadioGroup
          value={signIn}
          onValueChange={(v) => {
            setSignIn(v as QmSignIn)
            clearServerError("signIn")
          }}
          aria-label="Sign-in method"
          className="gap-2"
        >
          {SIGN_IN_OPTIONS.map((option) => {
            const id = `${idPrefix}-signin-${option.value}`
            const active = signIn === option.value
            return (
              <label
                key={option.value}
                htmlFor={id}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-1 border border-dashed border-border px-4 py-3 transition-colors",
                  active ? "bg-brand/5" : "hover:bg-surface-hover",
                )}
              >
                {active && (
                  <CornerBrackets size="sm" className="border-brand/50" />
                )}
                <RadioGroupItem
                  id={id}
                  value={option.value}
                  label={option.label}
                />
                <span className="pl-6 text-xs text-muted">
                  {option.description}
                </span>
              </label>
            )
          })}
        </RadioGroup>
        {serverErrors.signIn && (
          <p className="text-xs text-destructive">{serverErrors.signIn}</p>
        )}
      </FormSection>

      {/* 04 · Model */}
      <FormSection index="04" title="Model">
        <Field label="Provider" htmlFor={`${idPrefix}-provider`} required>
          <Select
            value={provider}
            onValueChange={(v) => handleProvider(v as QmModelProvider)}
          >
            <SelectTrigger
              id={`${idPrefix}-provider`}
              aria-label="Model provider"
            >
              <SelectValue>{() => PROVIDER_LABEL[provider]}</SelectValue>
            </SelectTrigger>
            <SelectPopup dropdown>
              {PROVIDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldError message={serverErrors.modelProvider} />
        </Field>

        <Field
          label={`${providerOption?.label ?? "Provider"} API key`}
          htmlFor={`${idPrefix}-key`}
          description="Validated before anything is created. Never shown again."
          required
        >
          <Input
            id={`${idPrefix}-key`}
            ref={keyRef}
            error={fieldError("modelKey")}
            type="password"
            defaultValue=""
            onChange={(e) => {
              setHasKey(e.target.value.trim().length > 0)
              clearServerError("modelKey")
            }}
            onBlur={() => setTouched((t) => ({ ...t, modelKey: true }))}
            placeholder={providerOption?.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="font-mono"
          />
        </Field>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex w-full cursor-pointer items-center gap-1.5 border-t border-dashed border-border pt-4 font-mono text-xs text-muted uppercase hover:text-foreground"
        >
          <CaretDownIcon
            className={cn(
              "size-3 transition-transform",
              showAdvanced && "rotate-180",
            )}
            weight="bold"
          />
          Advanced
        </button>

        <AnimatePresence initial={false}>
          {showAdvanced && (
            <motion.div
              key="advanced"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <Field
                label="Harness"
                htmlFor={`${idPrefix}-harness`}
                description="The agent runtime QM drives. pi is the default for every provider; vendor CLIs are only offered for their own provider."
              >
                <Select
                  value={harness}
                  onValueChange={(v) => {
                    setHarness(v as QmHarness)
                    clearServerError("harness")
                  }}
                >
                  <SelectTrigger
                    id={`${idPrefix}-harness`}
                    aria-label="Harness"
                  >
                    <SelectValue>{() => HARNESS_LABEL[harness]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup dropdown>
                    {HARNESS_OPTIONS.map((option) => {
                      const allowed = harnessAllowed(option.value, provider)
                      return (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          disabled={!allowed}
                        >
                          {option.label}
                          <span className="ml-2 text-xs text-muted">
                            {option.description}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectPopup>
                </Select>
                <FieldError message={serverErrors.harness} />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
      </FormSection>

      {/* 05 · Review */}
      <FormSection index="05" title="Review">
        <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-2 text-sm">
          <ReviewRow label="URL" mono>
            {url}
          </ReviewRow>
          <ReviewRow label="Admin">{adminEmail.trim() || "—"}</ReviewRow>
          <ReviewRow label="Sign-in">{SIGN_IN_LABEL[signIn]}</ReviewRow>
          <ReviewRow label="Provider">{PROVIDER_LABEL[provider]}</ReviewRow>
          <ReviewRow label="API key" mono>
            {hasKey ? "••••••••" : "—"}
          </ReviewRow>
          <ReviewRow label="Harness" mono>
            {HARNESS_LABEL[harness]}
          </ReviewRow>
        </dl>

        {(submitError || otherServerErrors.length > 0) && (
          <div
            role="alert"
            className="border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {submitError && <p>{submitError}</p>}
            {otherServerErrors.map(([name, message]) => (
              <p key={name}>{message}</p>
            ))}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Provisioning takes a few minutes. You can watch each step.
          </p>
          <Button
            type="submit"
            disabled={create.isPending}
            aria-busy={create.isPending}
            className="w-full sm:w-auto"
          >
            {create.isPending ? (
              <>
                <Spinner size="sm" />
                Creating…
              </>
            ) : (
              "Create stack"
            )}
          </Button>
        </div>
      </FormSection>
    </form>
  )
}

function FormSection({
  index,
  title,
  children,
}: {
  index: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border border-dashed border-border">
      <h2 className="flex h-10 items-center gap-2 border-b border-dashed border-border px-4 font-mono text-xs text-muted uppercase">
        <span className="text-brand">{index}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
    </section>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

function ReviewRow({
  label,
  mono,
  children,
}: {
  label: string
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="font-mono text-xs text-muted uppercase">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-all text-foreground/80",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </dd>
    </>
  )
}

function SlugStatus({
  slug,
  settled,
  taken,
  valid,
  available,
}: {
  slug: string
  settled: boolean
  taken: boolean
  valid: boolean
  available: boolean | undefined
}) {
  if (!slug || !valid) return null
  if (!settled) return <Spinner size="sm" aria-label="Checking availability" />
  if (taken)
    return (
      <XIcon
        className="size-3.5 text-destructive"
        weight="bold"
        aria-label="Taken"
      />
    )
  if (available)
    return (
      <CheckIcon
        className="size-3.5 text-brand"
        weight="bold"
        aria-label="Available"
      />
    )
  return null
}
