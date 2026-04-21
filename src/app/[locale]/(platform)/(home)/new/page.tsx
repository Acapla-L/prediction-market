'use cache'

import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import HomeClient from '@/app/[locale]/(platform)/(home)/_components/HomeClient'
import { getNewPageSeoTitle } from '@/lib/platform-routing'

const MAIN_TAG_SLUG = 'new' as const

export const metadata: Metadata = {
  title: getNewPageSeoTitle(),
}

export default async function NewPage({ params }: PageProps<'/[locale]/new'>) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="container grid gap-4 py-4">
      <HomeClient
        initialEvents={[]}
        initialCurrentTimestamp={null}
        initialTag={MAIN_TAG_SLUG}
        initialMainTag={MAIN_TAG_SLUG}
      />
    </main>
  )
}
