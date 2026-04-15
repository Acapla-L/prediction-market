import { BriefcaseIcon, ScaleIcon, ShieldCheckIcon } from 'lucide-react'
import { getExtracted } from 'next-intl/server'

interface InfoBoxProps {
  href: string
  background: string
  foreground: string
  iconTint: string
  icon: React.ReactNode
  title: string
  subtitle: string
  external?: boolean
}

function InfoBox({ href, background, foreground, iconTint, icon, title, subtitle, external }: InfoBoxProps) {
  const linkProps = external
    ? { target: '_blank', rel: 'noopener noreferrer' as const }
    : {}

  return (
    <a
      href={href}
      {...linkProps}
      className={`
        group flex flex-row items-center gap-4 overflow-hidden rounded-xl p-5 transition-all
        hover:-translate-y-0.5 hover:brightness-110
        ${background} ${foreground}
      `}
    >
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconTint}`}>
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm/tight font-bold">
          {title}
        </span>
        <span className="line-clamp-2 text-xs/snug opacity-80">
          {subtitle}
        </span>
      </div>
    </a>
  )
}

export default async function HomeV2InfoStrip() {
  const t = await getExtracted()

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <InfoBox
        href="https://wagerwire.com/for-sale"
        external
        background="bg-[#02FDDD]"
        foreground="text-neutral-900"
        iconTint="bg-black/10"
        icon={<BriefcaseIcon className="size-5" />}
        title={t('WagerWire')}
        subtitle={t('The marketplace for sports bets')}
      />
      {/* TODO: link to /responsible-gambling once the page ships */}
      <InfoBox
        href="#"
        background="bg-[#0B1B3A]"
        foreground="text-white"
        iconTint="bg-white/10"
        icon={<ShieldCheckIcon className="size-5" />}
        title={t('Responsible Trading')}
        subtitle={t('Tools and tips for trading smart')}
      />
      {/* TODO: link to /how-it-works once the page ships */}
      <InfoBox
        href="#"
        background="bg-[#1E1B4B]"
        foreground="text-white"
        iconTint="bg-white/10"
        icon={<ScaleIcon className="size-5" />}
        title={t('Market Integrity')}
        subtitle={t('How we ensure fair markets')}
      />
    </div>
  )
}
