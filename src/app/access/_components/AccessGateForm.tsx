'use client'

import type { AccessFormState } from '../actions'
import { REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp'
import { useSearchParams } from 'next/navigation'
import { useActionState, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { ACCESS_CODE_LENGTH } from '../_config'
import { submitAccessCode } from '../actions'

const initialState: AccessFormState = {}

export function AccessGateForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'
  const [value, setValue] = useState('')
  const [state, formAction, pending] = useActionState(submitAccessCode, initialState)

  return (
    <form action={formAction} className="flex flex-col items-center gap-6">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="code" value={value} />
      <label className="sr-only" htmlFor="access-code">
        Invitation code
      </label>
      <InputOTP
        id="access-code"
        maxLength={ACCESS_CODE_LENGTH}
        value={value}
        onChange={nextValue => setValue(nextValue.toUpperCase())}
        pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
        autoFocus
        containerClassName="gap-2 sm:gap-3"
        aria-invalid={state.error ? true : undefined}
      >
        <InputOTPGroup className="gap-2 sm:gap-3">
          {Array.from({ length: ACCESS_CODE_LENGTH }).map((_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className={`
                size-12 rounded-lg border border-border bg-background/60 font-mono text-xl font-semibold text-foreground
                uppercase shadow-inner transition [-webkit-text-security:disc] [text-security:disc]
                first:rounded-l-lg
                last:rounded-r-lg
                focus-visible:outline-none
                aria-invalid:border-destructive
                data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/40
                sm:size-14 sm:text-2xl
              `}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>

      <button
        type="submit"
        disabled={pending || value.length < ACCESS_CODE_LENGTH}
        className={`
          h-12 w-full rounded-lg bg-primary font-semibold tracking-wide text-primary-foreground transition
          hover:bg-primary/90
          focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2
          focus-visible:ring-offset-background focus-visible:outline-none
          disabled:cursor-not-allowed disabled:opacity-50
        `}
      >
        {pending ? 'Verifying…' : 'Enter platform'}
      </button>

      <p
        role="alert"
        aria-live="polite"
        className="min-h-5 text-center text-sm text-destructive"
      >
        {state.error ?? ''}
      </p>
    </form>
  )
}
