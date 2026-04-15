import { getExtracted } from 'next-intl/server'
import Image from 'next/image'

const WAGERWIRE_ABOUT_URL = 'https://www.wagerwire.com/about'

interface InfoBoxProps {
  title: string
  subtitle: string
}

function InfoBox({ title, subtitle }: InfoBoxProps) {
  return (
    <a
      href={WAGERWIRE_ABOUT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="
        group flex flex-row items-center gap-4 overflow-hidden rounded-xl border border-primary/25 bg-primary/5 p-5
        transition-all
        hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10
      "
    >
      <div
        className="
          flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-background/40
        "
      >
        <Image
          src="/brand/wagerwire-logo.png"
          alt="WagerWire"
          width={24}
          height={24}
          className="size-6 object-contain"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm/tight font-bold text-foreground">
          {title}
        </span>
        <span className="line-clamp-2 text-xs/snug text-muted-foreground">
          {subtitle}
        </span>
      </div>
    </a>
  )
}

export default async function HomeV2InfoStrip() {
  const t = await getExtracted()

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <InfoBox
        title={t('WagerWire')}
        subtitle={t('The marketplace for sports bets')}
      />
      <InfoBox
        title={t('Responsible Trading')}
        subtitle={t('Tools and tips for trading smart')}
      />
      <InfoBox
        title={t('Market Integrity')}
        subtitle={t('How we ensure fair markets')}
      />
    </div>
  )
}
