import type { Metadata } from 'next'
import { connection } from 'next/server'
import { setRequestLocale } from 'next-intl/server'
import HomeContent from '@/app/[locale]/(platform)/(home)/_components/HomeContent'
import { getNewPageSeoTitle } from '@/lib/platform-routing'

const MAIN_TAG_SLUG = 'new' as const

export const metadata: Metadata = {
  title: getNewPageSeoTitle(),
}

async function CachedHomeContent({ locale, initialTag }: { locale: string, initialTag: string }) {
  'use cache'
  return <HomeContent locale={locale} initialTag={initialTag} />
}

export default async function NewPage({ params }: PageProps<'/[locale]/new'>) {
  await connection()
  const { locale } = await params
  setRequestLocale(locale)

  return <CachedHomeContent locale={locale} initialTag={MAIN_TAG_SLUG} />
}
