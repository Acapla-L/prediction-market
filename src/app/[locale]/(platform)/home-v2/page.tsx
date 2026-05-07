import type { SupportedLocale } from '@/i18n/locales'
import { setRequestLocale } from 'next-intl/server'
import HomeV2PageContent from '@/app/[locale]/(platform)/home-v2/_components/HomeV2PageContent'

export default async function HomeV2Page({ params }: PageProps<'/[locale]/home-v2'>) {
  const { locale } = await params
  setRequestLocale(locale)
  return <HomeV2PageContent locale={locale as SupportedLocale} />
}
