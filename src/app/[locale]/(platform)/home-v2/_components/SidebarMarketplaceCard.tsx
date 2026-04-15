import { ChevronRightIcon } from 'lucide-react'
import { getExtracted } from 'next-intl/server'
import { Card } from '@/components/ui/card'

export default async function SidebarMarketplaceCard() {
  const t = await getExtracted()

  return (
    <a
      href="https://wagerwire.com/for-sale"
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <Card className="group flex flex-row items-center gap-3 p-4 transition-colors hover:bg-accent/50">
        <div className="
          flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 font-logo text-sm font-bold
          tracking-tight text-primary uppercase
        "
        >
          WW
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {t('Bet Slip Marketplace')}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {t('Buy and sell open bets on WagerWire')}
          </span>
        </div>
        <ChevronRightIcon className="
          size-4 shrink-0 text-muted-foreground transition-transform
          group-hover:translate-x-0.5
        "
        />
      </Card>
    </a>
  )
}
