'use client'

import AppLink from '@/components/AppLink'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'

interface HeaderLogoProps {
  labelSuffix?: string
}

export default function HeaderLogo({ labelSuffix }: HeaderLogoProps) {
  const site = useSiteIdentity()

  return (
    <AppLink
      intentPrefetch
      href="/"
      className={`
        flex h-10 shrink-0 items-center gap-2 text-lg font-medium text-foreground transition-opacity
        hover:opacity-80
        sm:text-xl
        md:text-2xl
      `}
    >
      <SiteLogoIcon
        logoSvg={site.logoSvg}
        logoImageUrl={site.logoImageUrl}
        alt={`${site.name} logo`}
        className="size-[1em] text-current [&_svg]:size-[1em] [&_svg_*]:fill-current [&_svg_*]:stroke-current"
        imageClassName="size-[1em] object-contain"
        size={32}
      />
      <span className="font-logo tracking-tight uppercase">
        <span className="font-bold">Wire</span>
        <span className="font-light">Predictions</span>
        {labelSuffix && <span className="ml-1 font-medium normal-case">{labelSuffix}</span>}
      </span>
    </AppLink>
  )
}
