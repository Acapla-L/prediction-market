export interface HomeV2CategoryConfig {
  id: 'sports' | 'finance' | 'politics' | 'tech'
  tagSlug: string
  titleKey: string
  href: string
}

export const HOME_V2_CATEGORIES: readonly HomeV2CategoryConfig[] = [
  { id: 'sports', tagSlug: 'sports', titleKey: 'Sports', href: '/sports' },
  { id: 'finance', tagSlug: 'finance', titleKey: 'Finance & Economy', href: '/finance' },
  { id: 'politics', tagSlug: 'politics', titleKey: 'Politics & World', href: '/politics' },
  { id: 'tech', tagSlug: 'tech', titleKey: 'Tech & Science', href: '/tech' },
] as const
