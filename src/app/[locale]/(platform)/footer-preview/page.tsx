import { setRequestLocale } from 'next-intl/server'
import { FooterVariantA, FooterVariantB, FooterVariantC } from '@/components/Footer'

export default async function FooterPreviewPage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="mb-12">
        <h1 className="text-3xl font-bold text-foreground">Footer Preview</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Three footer variations for review. Desktop only — footers are hidden on mobile to avoid
          conflicting with the bottom nav. Resize to ≥1024px to see them.
        </p>
      </header>

      <section className="mb-16">
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wider text-primary uppercase">
            Variation A — WagerWire Style
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Mirrors wagerwire.com structure: brand block + 4 link columns, compliance strip, copyright bar.
          </p>
        </div>
        <FooterVariantA />
      </section>

      <section className="mb-16">
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wider text-primary uppercase">
            Variation B — Kalshi / Regulatory Style
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Compliance-forward. Risk notice banner, Regulatory & Responsible Trading columns, 4 credential cards, fine-print legal.
          </p>
        </div>
        <FooterVariantB />
      </section>

      <section className="mb-16">
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wider text-primary uppercase">
            Variation C — Designer's Pick
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hero row leads with regulatory credibility + WagerWire attribution. Asymmetric grid, inline trust badges, primary-tinted copyright hairline.
          </p>
        </div>
        <FooterVariantC />
      </section>
    </div>
  )
}
