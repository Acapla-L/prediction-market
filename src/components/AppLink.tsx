'use client'

import type { ComponentPropsWithoutRef, ComponentRef, Ref } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@/i18n/navigation'

type NextLinkPrefetch = ComponentPropsWithoutRef<typeof Link>['prefetch']
type AppLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, 'prefetch'> & {
  intentPrefetch?: boolean
  prefetch?: NextLinkPrefetch
  ref?: Ref<AppLinkRef>
}
type AppLinkRef = ComponentRef<typeof Link>

/**
 * How long a hover/focus must persist before we treat it as "intent to
 * navigate" and enable Next.js prefetch (Fix F-2 2026-05-12). This filters a
 * quick cursor sweep across a card grid — which would otherwise fan out roughly
 * one RSC prefetch per card the cursor crossed — from a deliberate hover.
 *
 * Touch is intentionally NOT an intent trigger anymore: on mobile, `touchstart`
 * fires on whatever card the finger lands on at the start of a scroll gesture,
 * so flicking through a list (homepage shelves, a ~50-card `/sports/.../games`
 * grid) would prefetch every card scrolled past — a cold-render fan-out that
 * exhausted the DB pool in the 2026-05-12 cascade. Mobile users get the
 * browser's prefetch-on-tap instead.
 */
const INTENT_PREFETCH_DELAY_MS = 120

function AppLink({
  ref,
  intentPrefetch = false,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  prefetch = false,
  ...props
}: AppLinkProps) {
  const [shouldPrefetch, setShouldPrefetch] = useState(false)
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextPrefetch = prefetch === false ? null : prefetch
  const resolvedPrefetch = intentPrefetch
    ? (shouldPrefetch ? nextPrefetch : false)
    : prefetch

  useEffect(() => {
    return () => {
      if (intentTimer.current) {
        clearTimeout(intentTimer.current)
        intentTimer.current = null
      }
    }
  }, [])

  function armIntentPrefetch() {
    if (!intentPrefetch || shouldPrefetch || intentTimer.current) {
      return
    }
    intentTimer.current = setTimeout(() => {
      intentTimer.current = null
      setShouldPrefetch(true)
    }, INTENT_PREFETCH_DELAY_MS)
  }

  function cancelIntentPrefetch() {
    if (intentTimer.current) {
      clearTimeout(intentTimer.current)
      intentTimer.current = null
    }
  }

  return (
    <Link
      ref={ref}
      {...props}
      prefetch={resolvedPrefetch}
      onMouseEnter={(event) => {
        armIntentPrefetch()
        onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
        cancelIntentPrefetch()
        onMouseLeave?.(event)
      }}
      onFocus={(event) => {
        armIntentPrefetch()
        onFocus?.(event)
      }}
      onBlur={(event) => {
        cancelIntentPrefetch()
        onBlur?.(event)
      }}
      onTouchStart={onTouchStart}
    />
  )
}

export default AppLink
