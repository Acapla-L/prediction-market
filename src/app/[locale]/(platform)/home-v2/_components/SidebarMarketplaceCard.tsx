import { ChevronRightIcon, ShoppingCartIcon } from 'lucide-react'
import { getExtracted } from 'next-intl/server'

export default async function SidebarMarketplaceCard() {
  const t = await getExtracted()

  return (
    <a
      href="https://wagerwire.com/for-sale"
      target="_blank"
      rel="noopener noreferrer"
      className="
        group flex flex-row items-center gap-3 rounded-xl border border-primary/30 bg-transparent p-4 transition-colors
        hover:border-primary/50 hover:bg-primary/5
      "
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/30 text-primary"
      >
        <ShoppingCartIcon className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">
          {t('Hot on the wire')}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {t('Buy and sell open bets on WagerWire')}
        </span>
      </div>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </a>
  )
}
