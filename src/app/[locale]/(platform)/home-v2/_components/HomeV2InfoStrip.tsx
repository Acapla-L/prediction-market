import type { ReactNode } from 'react'
import { ScaleIcon, ShieldCheckIcon } from 'lucide-react'
import { getExtracted } from 'next-intl/server'

const WAGERWIRE_ABOUT_URL = 'https://www.wagerwire.com/about'

// The wagerwire-logo.png asset is 1770x350 — a horizontal wordmark where the
// circular W mark occupies the leftmost ~350x350 square. We render only that
// square by using background-size: auto 100% (scales the image to the
// container height) + background-position: left center (shows leftmost pixels).
// This avoids shipping a new cropped asset.
const WW_MARK_STYLE = {
  backgroundImage: 'url(\'/brand/wagerwire-logo.png\')',
  backgroundSize: 'auto 100%',
  backgroundPosition: 'left center',
  backgroundRepeat: 'no-repeat',
} as const

interface InfoBoxProps {
  title: string
  subtitle: string
  icon: ReactNode
}

function InfoBox({ title, subtitle, icon }: InfoBoxProps) {
  return (
    <a
      href={WAGERWIRE_ABOUT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="
        group flex w-[240px] shrink-0 flex-row items-center gap-3 overflow-hidden rounded-xl border border-primary/25
        bg-primary/5 p-4 transition-all
        hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10
        md:w-auto md:shrink md:gap-4 md:p-5
      "
    >
      <div
        className="
          flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-background/40
          text-primary
          md:size-10
        "
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs/tight font-bold text-foreground md:text-sm">
          {title}
        </span>
        <span className="line-clamp-2 text-2xs leading-snug text-muted-foreground md:text-xs">
          {subtitle}
        </span>
      </div>
    </a>
  )
}

export default async function HomeV2InfoStrip() {
  const t = await getExtracted()

  return (
    <div
      className="
        -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]
        md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0
        [&::-webkit-scrollbar]:hidden
      "
    >
      <InfoBox
        title={t('WagerWire')}
        subtitle={t('The marketplace for sports bets')}
        icon={(
          <div
            role="img"
            aria-label="WagerWire"
            className="size-5"
            style={WW_MARK_STYLE}
          />
        )}
      />
      <InfoBox
        title={t('Responsible Trading')}
        subtitle={t('Tools and tips for trading smart')}
        icon={<ShieldCheckIcon className="size-5" />}
      />
      <InfoBox
        title={t('Market Integrity')}
        subtitle={t('How we ensure fair markets')}
        icon={<ScaleIcon className="size-5" />}
      />
    </div>
  )
}
