'use client'

import type { AccessFormState } from '../actions'
import { useActionState } from 'react'
import { submitAccessCode } from '../actions'

interface Props {
  next: string
}

const initialState: AccessFormState = {}

export function AccessGateForm({ next }: Props) {
  const [state, formAction, pending] = useActionState(submitAccessCode, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="sr-only" htmlFor="access-code">
        Access code
      </label>
      <input
        id="access-code"
        name="code"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        maxLength={16}
        placeholder="ACCESS CODE"
        className="
          h-14 w-full rounded-md border border-input bg-input/50 px-4 text-center font-mono text-2xl tracking-[0.4em]
          text-foreground uppercase
          placeholder:text-muted-foreground/50
          focus:border-primary focus:ring-2 focus:ring-primary/40 focus:outline-none
        "
      />
      <button
        type="submit"
        disabled={pending}
        className="
          h-12 w-full rounded-md bg-primary font-semibold text-primary-foreground transition
          hover:opacity-90
          disabled:cursor-not-allowed disabled:opacity-60
        "
      >
        {pending ? 'Verifying…' : 'Enter platform'}
      </button>
      {state.error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
