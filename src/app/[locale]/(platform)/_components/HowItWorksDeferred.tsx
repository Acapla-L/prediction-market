'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUser } from '@/stores/useUser'

const HowItWorks = dynamic(
  () => import('@/app/[locale]/(platform)/_components/HowItWorks'),
  { ssr: false },
)

export default function HowItWorksDeferred() {
  const user = useUser()
  const isMobile = useIsMobile()
  const [shouldRender, setShouldRender] = useState(false)
  const shouldRenderInHeader = !isMobile

  useEffect(() => {
    if (user || !shouldRenderInHeader) {
      return
    }

    function renderHowItWorks() {
      setShouldRender(true)
    }

    // Load on idle so first paint isn't blocked, but don't require user
    // interaction — the link should appear on every route as soon as the
    // browser is free (typically within a few hundred ms of hydration).
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(renderHowItWorks, { timeout: 1500 })
      return () => {
        idleWindow.cancelIdleCallback?.(handle)
      }
    }

    const timeoutId = window.setTimeout(renderHowItWorks, 500)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shouldRenderInHeader, user])

  if (user || !shouldRender || !shouldRenderInHeader) {
    return null
  }

  return <HowItWorks />
}
