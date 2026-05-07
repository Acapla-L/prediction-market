'use cache'

import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import HomeContent from '@/app/[locale]/(platform)/(home)/_components/HomeContent'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function HomeV1Page({ params }: PageProps<'/[locale]/home-v1'>) {
  const { locale } = await params
  setRequestLocale(locale)
  return <HomeContent locale={locale} />
}
