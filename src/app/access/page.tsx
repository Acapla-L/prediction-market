import type { Metadata } from 'next'
import { AccessGateForm } from './_components/AccessGateForm'
import { AccessGateLogo } from './_components/AccessGateLogo'

export const metadata: Metadata = {
  title: 'Private Preview — WirePredictions',
  description: 'This platform is in private preview. Enter your access code to continue.',
  robots: { index: false, follow: false },
}

interface Props {
  searchParams: Promise<{ next?: string }>
}

export default async function AccessPage({ searchParams }: Props) {
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : '/'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <AccessGateLogo />

        <div className="w-full rounded-xl border border-border bg-card p-8 shadow-2xl">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold text-foreground">Private Preview</h1>
            <p className="text-sm text-muted-foreground">
              This platform is in private preview. Enter your access code to continue.
            </p>
          </div>
          <AccessGateForm next={next} />
        </div>

        <p className="text-xs text-muted-foreground">Powered by WagerWire</p>
      </div>
    </main>
  )
}
