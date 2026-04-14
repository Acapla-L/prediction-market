'use cache'

import type { Metadata } from 'next'
import Image from 'next/image'
import { Suspense } from 'react'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import { AccessGateForm } from './_components/AccessGateForm'

const WAGERWIRE_URL = 'https://www.wagerwire.com/'

export const metadata: Metadata = {
  title: 'Private Preview — WirePredictions',
  description: 'This platform is in private preview. Enter your invitation code to continue.',
  robots: { index: false, follow: false },
}

export default async function AccessPage() {
  const { site } = await loadRuntimeThemeState()

  return (
    <main className="
      relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 py-12
    "
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-primary/15 blur-[140px]"
      />
      <div
        aria-hidden
        className="
          pointer-events-none absolute -right-40 -bottom-40 size-[520px] rounded-full bg-primary/10 blur-[160px]
        "
      />
      <div
        aria-hidden
        className="
          pointer-events-none absolute inset-0
          bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.04),transparent_60%)]
        "
      />

      <div className="relative flex w-full max-w-md flex-col items-center gap-10">
        <div className="flex items-center gap-3 text-2xl sm:text-3xl">
          <SiteLogoIcon
            logoSvg={site.logoSvg}
            logoImageUrl={site.logoImageUrl}
            alt={`${site.name} logo`}
            className="size-[1.1em] text-current [&_svg]:size-[1.1em] [&_svg_*]:fill-current [&_svg_*]:stroke-current"
            imageClassName="size-[1.1em] object-contain"
            size={40}
          />
          <span className="font-logo tracking-tight text-foreground uppercase">
            <span className="font-bold">Wire</span>
            <span className="font-light">Predictions</span>
          </span>
        </div>

        <div
          className={`
            w-full rounded-2xl border border-border/80 bg-card/70 p-8
            shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_40px_80px_-20px_rgba(0,0,0,0.6),0_0_60px_-20px_var(--color-primary,rgba(0,255,178,0.25))]
            backdrop-blur-xl
            sm:p-10
          `}
        >
          <div className="mb-8 flex flex-col items-center gap-2 text-center">
            <span className="font-logo text-xs tracking-[0.35em] text-primary uppercase">
              Private Preview
            </span>
            <h1 className="text-2xl font-semibold text-foreground sm:text-[1.75rem]">
              Enter your invitation code
            </h1>
            <p className="max-w-sm text-sm/relaxed text-muted-foreground">
              This platform is in private preview. Access is granted by invitation only.
            </p>
          </div>

          <Suspense fallback={null}>
            <AccessGateForm />
          </Suspense>
        </div>

        <a
          href={WAGERWIRE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`
            group inline-flex items-center gap-2 text-xs tracking-wide text-muted-foreground transition
            hover:text-foreground
          `}
          aria-label="Powered by WagerWire — opens wagerwire.com"
        >
          <span>Powered by</span>
          <Image
            src="/brand/wagerwire-logo.png"
            alt="WagerWire"
            width={120}
            height={24}
            priority
            className="h-5 w-auto opacity-80 transition group-hover:opacity-100"
          />
        </a>
      </div>
    </main>
  )
}
